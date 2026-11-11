/*
  A copy of each linked customer's Lightspeed (Ecwid) record, kept in our own
  database: pricing group, discount, contact and address details, order totals.

  One row per website account that has a store account. It is filled in when
  the account is linked and refreshed whenever the customer opens their account
  page (src/server/lightspeed.ts). Unlinking, or deleting the website account,
  removes the row. Lightspeed stays the source of truth; this is a snapshot.

  Run after 001_accounts.sql, as a SQL Server administrator. Safe to run again.
    sqlcmd -E -S localhost -b -i db\003_lightspeed_data.sql
*/
SET QUOTED_IDENTIFIER ON;
GO

USE WOODYS_IND;
GO

IF OBJECT_ID(N'dbo.LightspeedCustomers', N'U') IS NULL
CREATE TABLE dbo.LightspeedCustomers (
    UserId               INT            NOT NULL CONSTRAINT PK_LightspeedCustomers PRIMARY KEY
                                        CONSTRAINT FK_LightspeedCustomers_Links REFERENCES dbo.LightspeedLinks(UserId) ON DELETE CASCADE,
    EcwidCustomerId      BIGINT         NOT NULL,
    ExternalReferenceId  NVARCHAR(100)  NULL,      -- the customer's id in Lightspeed Retail (POS), when synced from there

    -- Who they are
    Email                NVARCHAR(254)  NULL,
    Name                 NVARCHAR(200)  NULL,
    FirstName            NVARCHAR(100)  NULL,
    LastName             NVARCHAR(100)  NULL,
    CompanyName          NVARCHAR(200)  NULL,
    Phone                NVARCHAR(50)   NULL,

    -- Billing address
    Street               NVARCHAR(300)  NULL,
    City                 NVARCHAR(100)  NULL,
    StateCode            NVARCHAR(20)   NULL,
    PostalCode           NVARCHAR(20)   NULL,
    CountryCode          NVARCHAR(5)    NULL,

    -- Pricing: the customer group (tier) and the discount Lightspeed gives that group
    CustomerGroupId      BIGINT         NULL,      -- NULL = no group (standard pricing)
    CustomerGroupName    NVARCHAR(200)  NULL,
    DiscountPercent      DECIMAL(6,3)   NULL,      -- best active percent-off promotion for the group; NULL = none
    DiscountName         NVARCHAR(200)  NULL,
    DiscountDescription  NVARCHAR(500)  NULL,

    -- Tax and preferences
    TaxExempt            BIT            NULL,
    TaxId                NVARCHAR(100)  NULL,
    CustomerType         VARCHAR(10)    NULL,      -- 'b2b' or 'b2c'
    AcceptMarketing      BIT            NULL,
    Lang                 NVARCHAR(10)   NULL,

    -- Order totals as Lightspeed reports them
    OrderCount           INT            NULL,
    CanceledOrderCount   INT            NULL,
    SalesValue           DECIMAL(18,2)  NULL,
    AverageOrderValue    DECIMAL(18,2)  NULL,

    RegisteredAt         DATETIME2(0)   NULL,      -- UTC
    LightspeedUpdatedAt  DATETIME2(0)   NULL,      -- UTC

    -- Everything else, as Lightspeed sent it (JSON)
    ShippingAddressesJson NVARCHAR(MAX) NULL,
    ContactsJson          NVARCHAR(MAX) NULL,
    PromotionsJson        NVARCHAR(MAX) NULL,      -- every active promotion that applies to their group
    RawJson               NVARCHAR(MAX) NULL,      -- the whole customer record

    SyncedAt             DATETIME2(0)   NOT NULL CONSTRAINT DF_LightspeedCustomers_SyncedAt DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LightspeedCustomers_Customer' AND object_id = OBJECT_ID(N'dbo.LightspeedCustomers'))
    CREATE INDEX IX_LightspeedCustomers_Customer ON dbo.LightspeedCustomers (EcwidCustomerId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LightspeedCustomers_Group' AND object_id = OBJECT_ID(N'dbo.LightspeedCustomers'))
    CREATE INDEX IX_LightspeedCustomers_Group ON dbo.LightspeedCustomers (CustomerGroupId);
GO
