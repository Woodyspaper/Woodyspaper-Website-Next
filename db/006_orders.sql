/*
  Orders placed through the website's own checkout.

    dbo.Orders       one row per order: who, where it goes, the money, the
                     card payment's outcome, and whether it has reached
                     Lightspeed Retail yet
    dbo.OrderLines   what was ordered, at the price charged
    dbo.OrderEvents  the order's history: payment, emails, each attempt to
                     send it to Lightspeed Retail

  How an order moves:
    1. The customer presses "Place order". A row is saved with Status
       'pending' BEFORE the card is charged, so the gateway can be given our
       order number and a lost answer can be looked up afterwards.
    2. The card is charged. Approved -> 'paid' (stock is reserved and the
       emails go out). Declined -> 'declined'. No clear answer from the
       gateway, even after asking it again -> 'payment_unknown', for staff to
       check before anything ships.
    3. A paid order is sent to Lightspeed Retail as a sale. RetailSyncStatus
       goes 'pending' -> 'synced', or 'failed' after too many attempts.

  IdempotencyKey is one random key per checkout attempt, made by the
  customer's browser. It is unique, so a double click or a retry finds the
  first order instead of creating (and charging for) a second one.

  No card data is ever stored here: no card number, expiry date or security
  code. The card is typed into the payment gateway's own fields; we keep only
  the gateway's transaction number and its answer.

  Amounts are in dollars. UnitPrice keeps Lightspeed's 5 decimals; totals are
  to the cent (see src/server/checkout/totals.ts for the rounding rules).

  Touches only WOODYS_IND. Safe to run again.

  The website's own login (woodys_web, db/002_web_login.sql) may only read
  and write rows; it cannot create tables. So run this as a SQL Server
  administrator, after 005_customers_pricing.sql:
    sqlcmd -E -S localhost -b -i db\006_orders.sql
  Nothing more is needed for the website to use the new tables: its login
  already reads and writes every table in this database.
*/
SET QUOTED_IDENTIFIER ON;
GO
USE WOODYS_IND;
GO

/*
  Order numbers start at W100001: the number is the row's Id with a W in
  front, so it is short enough to read over the phone.

  UserId is the website account that placed it, CustomerId the store customer
  it was priced for. Both are empty for a guest. An order outlives the
  account: deleting a website account leaves its orders in place.
*/
IF OBJECT_ID(N'dbo.Orders', N'U') IS NULL
CREATE TABLE dbo.Orders (
    Id                  INT IDENTITY(100001,1) NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
    OrderNumber         AS (CONVERT(VARCHAR(12), 'W' + CONVERT(VARCHAR(11), Id))) PERSISTED NOT NULL,
    IdempotencyKey      VARCHAR(64)    NOT NULL CONSTRAINT UQ_Orders_IdempotencyKey UNIQUE,
    UserId              INT            NULL CONSTRAINT FK_Orders_Users REFERENCES dbo.Users(Id) ON DELETE SET NULL,
    CustomerId          INT            NULL CONSTRAINT FK_Orders_Customers REFERENCES dbo.Customers(Id),

    -- Who to contact about the order.
    ContactName         NVARCHAR(200)  NOT NULL,
    ContactEmail        NVARCHAR(254)  NOT NULL,
    ContactPhone        NVARCHAR(50)   NULL,
    CompanyName         NVARCHAR(200)  NULL,
    CustomerNote        NVARCHAR(1000) NULL,     -- what the customer typed in "order notes"

    -- How it gets there. The address is empty for pickup.
    DeliveryMethod      VARCHAR(10)    NOT NULL CONSTRAINT CK_Orders_DeliveryMethod CHECK (DeliveryMethod IN ('pickup', 'local', 'ups')),
    DeliveryService     NVARCHAR(60)   NULL,     -- UPS only: the service chosen, e.g. "03 Ground"
    ShipName            NVARCHAR(200)  NULL,
    ShipCompany         NVARCHAR(200)  NULL,
    ShipStreet1         NVARCHAR(300)  NULL,
    ShipStreet2         NVARCHAR(300)  NULL,
    ShipCity            NVARCHAR(100)  NULL,
    ShipStateCode       NVARCHAR(20)   NULL,
    ShipPostalCode      NVARCHAR(20)   NULL,
    ShipCountryCode     CHAR(2)        NULL,

    -- The card's billing address, sent to the gateway for its address check.
    BillStreet1         NVARCHAR(300)  NULL,
    BillStreet2         NVARCHAR(300)  NULL,
    BillCity            NVARCHAR(100)  NULL,
    BillStateCode       NVARCHAR(20)   NULL,
    BillPostalCode      NVARCHAR(20)   NULL,
    BillCountryCode     CHAR(2)        NULL,

    -- The money, as charged. Total = Subtotal + Delivery + Tax.
    TaxExempt           BIT            NOT NULL CONSTRAINT DF_Orders_TaxExempt DEFAULT 0,
    TaxRatePercent      DECIMAL(7,4)   NOT NULL,                 -- the rate in force when it was placed
    SubtotalAmount      DECIMAL(12,2)  NOT NULL,
    DeliveryAmount      DECIMAL(12,2)  NOT NULL CONSTRAINT DF_Orders_DeliveryAmount DEFAULT 0,
    DeliveryTaxAmount   DECIMAL(12,2)  NOT NULL CONSTRAINT DF_Orders_DeliveryTaxAmount DEFAULT 0,  -- the part of TaxAmount charged on delivery
    TaxAmount           DECIMAL(12,2)  NOT NULL,
    TotalAmount         DECIMAL(12,2)  NOT NULL,

    Status              VARCHAR(20)    NOT NULL CONSTRAINT DF_Orders_Status DEFAULT 'pending'
                        CONSTRAINT CK_Orders_Status CHECK (Status IN ('pending', 'paid', 'declined', 'payment_unknown', 'cancelled', 'refunded')),

    -- The gateway's answer. Never card data.
    GatewayTransactionId VARCHAR(40)   NULL,
    GatewayAuthCode     VARCHAR(20)    NULL,
    GatewayResponseCode VARCHAR(10)    NULL,     -- 100 = approved; see the gateway's result code table
    GatewayResponseText NVARCHAR(200)  NULL,
    GatewayAvsResult    VARCHAR(5)     NULL,     -- address check result code
    GatewayCvvResult    VARCHAR(5)     NULL,     -- security code check result code
    PaidAt              DATETIME2(0)   NULL,

    -- Sending the paid order to Lightspeed Retail.
    RetailSyncStatus    VARCHAR(10)    NOT NULL CONSTRAINT DF_Orders_RetailSyncStatus DEFAULT 'none'
                        CONSTRAINT CK_Orders_RetailSyncStatus CHECK (RetailSyncStatus IN ('none', 'pending', 'synced', 'failed')),
    RetailSyncAttempts  INT            NOT NULL CONSTRAINT DF_Orders_RetailSyncAttempts DEFAULT 0,
    RetailSyncLastAt    DATETIME2(0)   NULL,
    RetailSyncNextAt    DATETIME2(0)   NULL,     -- when to try again
    RetailSyncError     NVARCHAR(500)  NULL,     -- why the last attempt failed
    RetailSaleId        VARCHAR(40)    NULL,     -- the sale's id in Lightspeed Retail
    RetailInvoiceNumber NVARCHAR(40)   NULL,     -- the receipt number the register shows

    ClientIp            VARCHAR(45)    NULL,     -- the address the order came from, for fraud checks
    CreatedAt           DATETIME2(0)   NOT NULL CONSTRAINT DF_Orders_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt           DATETIME2(0)   NOT NULL CONSTRAINT DF_Orders_UpdatedAt DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_Orders_Amounts CHECK (
        SubtotalAmount >= 0 AND DeliveryAmount >= 0 AND TaxAmount >= 0 AND DeliveryTaxAmount >= 0
        AND DeliveryTaxAmount <= TaxAmount
        AND TotalAmount = SubtotalAmount + DeliveryAmount + TaxAmount
    ),
    -- An order can only be marked paid with the gateway's transaction number on it.
    CONSTRAINT CK_Orders_PaidHasTransaction CHECK (Status <> 'paid' OR (GatewayTransactionId IS NOT NULL AND PaidAt IS NOT NULL))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_Orders_OrderNumber' AND object_id = OBJECT_ID(N'dbo.Orders'))
    CREATE UNIQUE INDEX UQ_Orders_OrderNumber ON dbo.Orders (OrderNumber);
GO
/* One gateway transaction pays for one order, and one Lightspeed sale records one order. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_Orders_GatewayTransactionId' AND object_id = OBJECT_ID(N'dbo.Orders'))
    CREATE UNIQUE INDEX UQ_Orders_GatewayTransactionId ON dbo.Orders (GatewayTransactionId) WHERE GatewayTransactionId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_Orders_RetailSaleId' AND object_id = OBJECT_ID(N'dbo.Orders'))
    CREATE UNIQUE INDEX UQ_Orders_RetailSaleId ON dbo.Orders (RetailSaleId) WHERE RetailSaleId IS NOT NULL;
GO
/* "My orders" on the account page. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Orders_UserId' AND object_id = OBJECT_ID(N'dbo.Orders'))
    CREATE INDEX IX_Orders_UserId ON dbo.Orders (UserId, CreatedAt DESC) WHERE UserId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Orders_CustomerId' AND object_id = OBJECT_ID(N'dbo.Orders'))
    CREATE INDEX IX_Orders_CustomerId ON dbo.Orders (CustomerId, CreatedAt DESC) WHERE CustomerId IS NOT NULL;
GO
/* The background step that sends orders to Lightspeed Retail looks here for its work. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Orders_RetailSync' AND object_id = OBJECT_ID(N'dbo.Orders'))
    CREATE INDEX IX_Orders_RetailSync ON dbo.Orders (RetailSyncNextAt) WHERE RetailSyncStatus = 'pending';
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Orders_Status' AND object_id = OBJECT_ID(N'dbo.Orders'))
    CREATE INDEX IX_Orders_Status ON dbo.Orders (Status, CreatedAt);
GO

/*
  What was ordered. The SKU, names and price are copied in as they were on
  the day, so a later change to the catalog never rewrites an old order.

  VariantId points at the catalog while the variant still exists there;
  VariantRetailId is the same product's id in Lightspeed Retail, kept so the
  order can still be sent to the register if the catalog row has gone.

  PriceSource says which pricing rule gave UnitPrice (list price, the
  customer's own price, their price list, their group's discount), in the
  words the pricing rules use (src/server/pricing). ListPrice is what a guest
  would have paid, for showing the saving.
*/
IF OBJECT_ID(N'dbo.OrderLines', N'U') IS NULL
CREATE TABLE dbo.OrderLines (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OrderLines PRIMARY KEY,
    OrderId         INT            NOT NULL CONSTRAINT FK_OrderLines_Orders REFERENCES dbo.Orders(Id),
    LineNumber      INT            NOT NULL,     -- 1, 2, 3… in the order the cart showed them
    VariantId       INT            NULL CONSTRAINT FK_OrderLines_Variants REFERENCES dbo.ProductVariants(Id) ON DELETE SET NULL,
    VariantRetailId VARCHAR(40)    NULL,
    Sku             NVARCHAR(100)  NOT NULL,
    ProductName     NVARCHAR(300)  NOT NULL,
    Options         NVARCHAR(600)  NULL,         -- the choices made, e.g. "UOM: REAM / COLOR: WHITE"
    Quantity        INT            NOT NULL CONSTRAINT CK_OrderLines_Quantity CHECK (Quantity > 0),
    UnitPrice       DECIMAL(12,5)  NOT NULL CONSTRAINT CK_OrderLines_UnitPrice CHECK (UnitPrice > 0),  -- before tax
    ListPrice       DECIMAL(12,5)  NULL,
    PriceSource     VARCHAR(20)    NOT NULL,
    Taxable         BIT            NOT NULL CONSTRAINT DF_OrderLines_Taxable DEFAULT 1,
    LineTotal       DECIMAL(12,2)  NOT NULL,     -- UnitPrice x Quantity, to the cent
    TaxAmount       DECIMAL(12,2)  NOT NULL CONSTRAINT DF_OrderLines_TaxAmount DEFAULT 0,  -- this line's share of the order's tax
    WeightLb        DECIMAL(10,3)  NULL,         -- of one, for shipping
    CONSTRAINT UQ_OrderLines_Line UNIQUE (OrderId, LineNumber),
    CONSTRAINT CK_OrderLines_Amounts CHECK (LineTotal >= 0 AND TaxAmount >= 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_OrderLines_VariantId' AND object_id = OBJECT_ID(N'dbo.OrderLines'))
    CREATE INDEX IX_OrderLines_VariantId ON dbo.OrderLines (VariantId) WHERE VariantId IS NOT NULL;
GO

/*
  What happened to an order, and when. One row per happening; rows are added,
  never changed. Kind is a short word for what it was:

    created            the order was saved, before payment
    payment_approved   the card was charged
    payment_declined   the bank said no
    payment_error      the gateway could not process it
    payment_unknown    no clear answer; staff must check the gateway
    payment_voided     a charge was cancelled before it settled
    payment_refunded   money was returned
    stock_reserved     stock was set aside for the order
    email_customer     the confirmation email to the customer
    email_store        the new-order email to the store
    retail_sync        an attempt to send it to Lightspeed Retail
    note               anything staff want to record

  Ok is 1 when it worked, 0 when it failed, empty when that makes no sense.
  Detail is a short explanation in plain words. Never card data, and never a
  gateway key or token.
*/
IF OBJECT_ID(N'dbo.OrderEvents', N'U') IS NULL
CREATE TABLE dbo.OrderEvents (
    Id      BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OrderEvents PRIMARY KEY,
    OrderId INT            NOT NULL CONSTRAINT FK_OrderEvents_Orders REFERENCES dbo.Orders(Id),
    Kind    VARCHAR(30)    NOT NULL,
    Ok      BIT            NULL,
    Detail  NVARCHAR(1000) NULL,
    At      DATETIME2(0)   NOT NULL CONSTRAINT DF_OrderEvents_At DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_OrderEvents_Order' AND object_id = OBJECT_ID(N'dbo.OrderEvents'))
    CREATE INDEX IX_OrderEvents_Order ON dbo.OrderEvents (OrderId, At);
GO

/*
  Stock set aside or taken by an order now points at a real order.
  (dbo.StockMovements.OrderId was created in 004_catalog.sql before orders
  existed.)
*/
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_StockMovements_Orders' AND parent_object_id = OBJECT_ID(N'dbo.StockMovements'))
    ALTER TABLE dbo.StockMovements ADD CONSTRAINT FK_StockMovements_Orders FOREIGN KEY (OrderId) REFERENCES dbo.Orders(Id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockMovements_OrderId' AND object_id = OBJECT_ID(N'dbo.StockMovements'))
    CREATE INDEX IX_StockMovements_OrderId ON dbo.StockMovements (OrderId) WHERE OrderId IS NOT NULL;
GO
