/*
  The store's own customers and their pricing. Filled from Lightspeed Retail
  by scripts/import-lightspeed.mjs.

  How a customer's price for a variant is found, most specific first:
    1. dbo.CustomerPrices      a price agreed with that one customer
    2. dbo.PriceListItems      the customer's price list (their own, else their group's)
    3. dbo.CustomerGroups      the group's percent off list price, unless the
                               product is in an excluded category
    4. dbo.ProductVariants     list price

  Touches only WOODYS_IND. Safe to run again.

  Run after 004_catalog.sql, as a SQL Server administrator:
    sqlcmd -E -S localhost -b -i db\005_customers_pricing.sql
*/
SET QUOTED_IDENTIFIER ON;
GO
USE WOODYS_IND;
GO

/* A full or partial list of agreed prices (a Lightspeed "price book"). */
IF OBJECT_ID(N'dbo.PriceLists', N'U') IS NULL
CREATE TABLE dbo.PriceLists (
    Id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PriceLists PRIMARY KEY,
    Name               NVARCHAR(200) NOT NULL,
    IsActive           BIT           NOT NULL CONSTRAINT DF_PriceLists_IsActive DEFAULT 1,
    LightspeedPlatform NVARCHAR(40)  NULL,   -- where Lightspeed applied it: "In Store" or "All platforms"
    RetailId           VARCHAR(40)   NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_PriceLists_RetailId' AND object_id = OBJECT_ID(N'dbo.PriceLists'))
    CREATE UNIQUE INDEX UQ_PriceLists_RetailId ON dbo.PriceLists (RetailId) WHERE RetailId IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.PriceListItems', N'U') IS NULL
CREATE TABLE dbo.PriceListItems (
    PriceListId INT           NOT NULL CONSTRAINT FK_PriceListItems_PriceLists REFERENCES dbo.PriceLists(Id) ON DELETE CASCADE,
    VariantId   INT           NOT NULL CONSTRAINT FK_PriceListItems_Variants REFERENCES dbo.ProductVariants(Id) ON DELETE CASCADE,
    Price       DECIMAL(12,5) NOT NULL CONSTRAINT CK_PriceListItems_Price CHECK (Price > 0),
    CONSTRAINT PK_PriceListItems PRIMARY KEY (PriceListId, VariantId)
);
GO

/* DiscountPercent is percent off list price: 28 means the customer pays 72%. */
IF OBJECT_ID(N'dbo.CustomerGroups', N'U') IS NULL
CREATE TABLE dbo.CustomerGroups (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CustomerGroups PRIMARY KEY,
    Name            NVARCHAR(200) NOT NULL,
    DiscountPercent DECIMAL(6,3)  NOT NULL CONSTRAINT DF_CustomerGroups_DiscountPercent DEFAULT 0
                    CONSTRAINT CK_CustomerGroups_DiscountPercent CHECK (DiscountPercent >= 0 AND DiscountPercent < 100),
    DiscountName    NVARCHAR(200) NULL,
    PriceListId     INT           NULL CONSTRAINT FK_CustomerGroups_PriceLists REFERENCES dbo.PriceLists(Id),
    RetailId        VARCHAR(40)   NULL,
    EcwidGroupId    BIGINT        NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_CustomerGroups_RetailId' AND object_id = OBJECT_ID(N'dbo.CustomerGroups'))
    CREATE UNIQUE INDEX UQ_CustomerGroups_RetailId ON dbo.CustomerGroups (RetailId) WHERE RetailId IS NOT NULL;
GO

/* Categories a group's percent discount does not apply to. */
IF OBJECT_ID(N'dbo.GroupDiscountExclusions', N'U') IS NULL
CREATE TABLE dbo.GroupDiscountExclusions (
    CustomerGroupId INT NOT NULL CONSTRAINT FK_GroupDiscountExclusions_Groups REFERENCES dbo.CustomerGroups(Id) ON DELETE CASCADE,
    CategoryId      INT NOT NULL CONSTRAINT FK_GroupDiscountExclusions_Categories REFERENCES dbo.Categories(Id) ON DELETE CASCADE,
    CONSTRAINT PK_GroupDiscountExclusions PRIMARY KEY (CustomerGroupId, CategoryId)
);
GO

/*
  One row per customer of the business, whether or not they have a website
  account. UserId is set once a website account (dbo.Users) has claimed it.
  Email is lower case and not unique: a few customers share one.
*/
IF OBJECT_ID(N'dbo.Customers', N'U') IS NULL
CREATE TABLE dbo.Customers (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Customers PRIMARY KEY,
    UserId          INT           NULL CONSTRAINT FK_Customers_Users REFERENCES dbo.Users(Id),
    CustomerCode    NVARCHAR(60)  NULL,
    Email           NVARCHAR(254) NULL,
    Name            NVARCHAR(200) NULL,
    FirstName       NVARCHAR(100) NULL,
    LastName        NVARCHAR(100) NULL,
    CompanyName     NVARCHAR(200) NULL,
    Phone           NVARCHAR(50)  NULL,
    Mobile          NVARCHAR(50)  NULL,
    CustomerGroupId INT           NULL CONSTRAINT FK_Customers_Groups REFERENCES dbo.CustomerGroups(Id),
    PriceListId     INT           NULL CONSTRAINT FK_Customers_PriceLists REFERENCES dbo.PriceLists(Id),  -- overrides the group's
    TaxExempt       BIT           NOT NULL CONSTRAINT DF_Customers_TaxExempt DEFAULT 0,  -- their tax in Lightspeed charges nothing
    TaxId           NVARCHAR(100) NULL,      -- the certificate number from the tax note in Lightspeed (see also 009_customer_tax.sql)
    OnAccountLimit  DECIMAL(12,2) NULL,
    IsActive        BIT           NOT NULL CONSTRAINT DF_Customers_IsActive DEFAULT 1,
    StaffNotes      NVARCHAR(MAX) NULL,      -- never shown to the customer
    RetailId        VARCHAR(40)   NULL,
    EcwidCustomerId BIGINT        NULL,
    SourceUpdatedAt DATETIME2(0)  NULL,
    CreatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_Customers_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_Customers_UpdatedAt DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_Customers_RetailId' AND object_id = OBJECT_ID(N'dbo.Customers'))
    CREATE UNIQUE INDEX UQ_Customers_RetailId ON dbo.Customers (RetailId) WHERE RetailId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_Customers_UserId' AND object_id = OBJECT_ID(N'dbo.Customers'))
    CREATE UNIQUE INDEX UQ_Customers_UserId ON dbo.Customers (UserId) WHERE UserId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Customers_Email' AND object_id = OBJECT_ID(N'dbo.Customers'))
    CREATE INDEX IX_Customers_Email ON dbo.Customers (Email) WHERE Email IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Customers_GroupId' AND object_id = OBJECT_ID(N'dbo.Customers'))
    CREATE INDEX IX_Customers_GroupId ON dbo.Customers (CustomerGroupId);
GO

/*
  LightspeedKind marks the two addresses the importer keeps in step with
  Lightspeed ('billing' = postal, 'shipping' = physical). Addresses a
  customer adds on the website have it NULL and are never touched by imports.
*/
IF OBJECT_ID(N'dbo.CustomerAddresses', N'U') IS NULL
CREATE TABLE dbo.CustomerAddresses (
    Id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CustomerAddresses PRIMARY KEY,
    CustomerId     INT           NOT NULL CONSTRAINT FK_CustomerAddresses_Customers REFERENCES dbo.Customers(Id) ON DELETE CASCADE,
    Kind           VARCHAR(10)   NOT NULL CONSTRAINT CK_CustomerAddresses_Kind CHECK (Kind IN ('billing', 'shipping')),
    IsDefault      BIT           NOT NULL CONSTRAINT DF_CustomerAddresses_IsDefault DEFAULT 0,
    Street1        NVARCHAR(300) NULL,
    Street2        NVARCHAR(300) NULL,
    City           NVARCHAR(100) NULL,
    StateCode      NVARCHAR(20)  NULL,
    PostalCode     NVARCHAR(20)  NULL,
    CountryCode    CHAR(2)       NULL,
    LightspeedKind VARCHAR(10)   NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CustomerAddresses_CustomerId' AND object_id = OBJECT_ID(N'dbo.CustomerAddresses'))
    CREATE INDEX IX_CustomerAddresses_CustomerId ON dbo.CustomerAddresses (CustomerId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_CustomerAddresses_Lightspeed' AND object_id = OBJECT_ID(N'dbo.CustomerAddresses'))
    CREATE UNIQUE INDEX UQ_CustomerAddresses_Lightspeed ON dbo.CustomerAddresses (CustomerId, LightspeedKind) WHERE LightspeedKind IS NOT NULL;
GO

/* A price agreed with one customer for one variant. Set by staff; imports never touch it. */
IF OBJECT_ID(N'dbo.CustomerPrices', N'U') IS NULL
CREATE TABLE dbo.CustomerPrices (
    CustomerId INT           NOT NULL CONSTRAINT FK_CustomerPrices_Customers REFERENCES dbo.Customers(Id) ON DELETE CASCADE,
    VariantId  INT           NOT NULL CONSTRAINT FK_CustomerPrices_Variants REFERENCES dbo.ProductVariants(Id) ON DELETE CASCADE,
    Price      DECIMAL(12,5) NOT NULL CONSTRAINT CK_CustomerPrices_Price CHECK (Price > 0),
    Note       NVARCHAR(300) NULL,
    UpdatedAt  DATETIME2(0)  NOT NULL CONSTRAINT DF_CustomerPrices_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_CustomerPrices PRIMARY KEY (CustomerId, VariantId)
);
GO
