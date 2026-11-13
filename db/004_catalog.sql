/*
  The store's own catalog: brands, categories, products, variants, images and
  stock. Filled from Lightspeed by scripts/import-lightspeed.mjs; once the
  site no longer uses Lightspeed these tables are the source of truth.

  A product is what a shopper sees as one page. Every product has at least one
  variant (a UOM / COLOR / FINISH / TYPE combination); the variant is what
  carries the SKU, price and stock, and what carts, orders and price lists
  point at.

  RetailId        = the id in Lightspeed Retail (the POS)
  Ecwid…Id        = the id in Lightspeed eCom, kept so old links can redirect

  Touches only WOODYS_IND. Safe to run again.

  Run after 003_lightspeed_data.sql, as a SQL Server administrator:
    sqlcmd -E -S localhost -b -i db\004_catalog.sql
*/
SET QUOTED_IDENTIFIER ON;
GO
USE WOODYS_IND;
GO

/* One row per run of the importer, dry runs included. */
IF OBJECT_ID(N'dbo.ImportRuns', N'U') IS NULL
CREATE TABLE dbo.ImportRuns (
    Id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ImportRuns PRIMARY KEY,
    Kind       VARCHAR(60)   NOT NULL,
    DryRun     BIT           NOT NULL,
    StartedAt  DATETIME2(0)  NOT NULL,
    FinishedAt DATETIME2(0)  NULL,
    Status     VARCHAR(10)   NOT NULL CONSTRAINT CK_ImportRuns_Status CHECK (Status IN ('ok', 'failed')),
    CountsJson NVARCHAR(MAX) NULL,
    Error      NVARCHAR(MAX) NULL
);
GO

/* One row. Bumped whenever catalog data changes, so the API knows to reload. */
IF OBJECT_ID(N'dbo.CatalogVersion', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CatalogVersion (
        Id        TINYINT      NOT NULL CONSTRAINT PK_CatalogVersion PRIMARY KEY CONSTRAINT CK_CatalogVersion_One CHECK (Id = 1),
        Version   BIGINT       NOT NULL,
        UpdatedAt DATETIME2(0) NOT NULL
    );
    INSERT dbo.CatalogVersion (Id, Version, UpdatedAt) VALUES (1, 1, SYSUTCDATETIME());
END
GO

IF OBJECT_ID(N'dbo.Brands', N'U') IS NULL
CREATE TABLE dbo.Brands (
    Id       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Brands PRIMARY KEY,
    Name     NVARCHAR(100) NOT NULL,
    Slug     NVARCHAR(120) NOT NULL CONSTRAINT UQ_Brands_Slug UNIQUE,
    IsShown  BIT           NOT NULL CONSTRAINT DF_Brands_IsShown DEFAULT 1,
    RetailId VARCHAR(40)   NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_Brands_RetailId' AND object_id = OBJECT_ID(N'dbo.Brands'))
    CREATE UNIQUE INDEX UQ_Brands_RetailId ON dbo.Brands (RetailId) WHERE RetailId IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.Categories', N'U') IS NULL
CREATE TABLE dbo.Categories (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Categories PRIMARY KEY,
    ParentId        INT           NULL CONSTRAINT FK_Categories_Parent REFERENCES dbo.Categories(Id),
    Name            NVARCHAR(200) NOT NULL,
    Slug            NVARCHAR(220) NOT NULL CONSTRAINT UQ_Categories_Slug UNIQUE,
    SortOrder       INT           NOT NULL CONSTRAINT DF_Categories_SortOrder DEFAULT 0,
    IsEnabled       BIT           NOT NULL CONSTRAINT DF_Categories_IsEnabled DEFAULT 1,
    IsHidden        BIT           NOT NULL CONSTRAINT DF_Categories_IsHidden DEFAULT 0,  -- kept, but not listed on the site
    ImageSourceUrl  VARCHAR(400)  NULL,     -- where the importer downloads the image from
    ImageKey        VARCHAR(120)  NULL,     -- the downloaded file, relative to MEDIA_DIR
    EcwidCategoryId BIGINT        NULL,
    RetailId        VARCHAR(40)   NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_Categories_EcwidCategoryId' AND object_id = OBJECT_ID(N'dbo.Categories'))
    CREATE UNIQUE INDEX UQ_Categories_EcwidCategoryId ON dbo.Categories (EcwidCategoryId) WHERE EcwidCategoryId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Categories_ParentId' AND object_id = OBJECT_ID(N'dbo.Categories'))
    CREATE INDEX IX_Categories_ParentId ON dbo.Categories (ParentId);
GO

IF OBJECT_ID(N'dbo.Products', N'U') IS NULL
CREATE TABLE dbo.Products (
    Id                INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
    Name              NVARCHAR(300) NOT NULL,
    Slug              NVARCHAR(320) NOT NULL CONSTRAINT UQ_Products_Slug UNIQUE,
    DescriptionHtml   NVARCHAR(MAX) NULL,
    BrandId           INT           NULL CONSTRAINT FK_Products_Brands REFERENCES dbo.Brands(Id),
    IsEnabled         BIT           NOT NULL,   -- shown on the website
    DefaultCategoryId INT           NULL CONSTRAINT FK_Products_Categories REFERENCES dbo.Categories(Id),
    SeoTitle          NVARCHAR(300) NULL,
    SeoDescription    NVARCHAR(MAX) NULL,
    SearchTags        NVARCHAR(MAX) NULL,       -- extra words the search matches
    RetailId          VARCHAR(40)   NULL,
    EcwidProductId    BIGINT        NULL,
    SourceUpdatedAt   DATETIME2(0)  NULL,       -- last change in Lightspeed
    CreatedAt         DATETIME2(0)  NOT NULL CONSTRAINT DF_Products_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)  NOT NULL CONSTRAINT DF_Products_UpdatedAt DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_Products_RetailId' AND object_id = OBJECT_ID(N'dbo.Products'))
    CREATE UNIQUE INDEX UQ_Products_RetailId ON dbo.Products (RetailId) WHERE RetailId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_Products_EcwidProductId' AND object_id = OBJECT_ID(N'dbo.Products'))
    CREATE UNIQUE INDEX UQ_Products_EcwidProductId ON dbo.Products (EcwidProductId) WHERE EcwidProductId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Products_BrandId' AND object_id = OBJECT_ID(N'dbo.Products'))
    CREATE INDEX IX_Products_BrandId ON dbo.Products (BrandId);
GO

/* Price is the list price before tax, as Lightspeed holds it (up to 5 decimals). */
IF OBJECT_ID(N'dbo.ProductVariants', N'U') IS NULL
CREATE TABLE dbo.ProductVariants (
    Id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductVariants PRIMARY KEY,
    ProductId          INT            NOT NULL CONSTRAINT FK_ProductVariants_Products REFERENCES dbo.Products(Id),
    Sku                NVARCHAR(100)  NOT NULL CONSTRAINT UQ_ProductVariants_Sku UNIQUE,
    Name               NVARCHAR(300)  NOT NULL,  -- the option values, e.g. "REAM / WHITE / SMOOTH"; '' when there are none
    Price              DECIMAL(12,5)  NOT NULL,
    Cost               DECIMAL(12,5)  NULL,      -- supply price; staff only
    SupplierCode       NVARCHAR(100)  NULL,
    Barcode            NVARCHAR(60)   NULL,
    WeightLb           DECIMAL(10,3)  NULL,
    LengthIn           DECIMAL(10,3)  NULL,
    WidthIn            DECIMAL(10,3)  NULL,
    HeightIn           DECIMAL(10,3)  NULL,
    IsDefault          BIT            NOT NULL,
    IsEnabled          BIT            NOT NULL,
    SortOrder          INT            NOT NULL CONSTRAINT DF_ProductVariants_SortOrder DEFAULT 0,
    RetailId           VARCHAR(40)    NULL,
    EcwidCombinationId BIGINT         NULL,
    CreatedAt          DATETIME2(0)   NOT NULL CONSTRAINT DF_ProductVariants_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt          DATETIME2(0)   NOT NULL CONSTRAINT DF_ProductVariants_UpdatedAt DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ProductVariants_ProductId' AND object_id = OBJECT_ID(N'dbo.ProductVariants'))
    CREATE INDEX IX_ProductVariants_ProductId ON dbo.ProductVariants (ProductId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_ProductVariants_RetailId' AND object_id = OBJECT_ID(N'dbo.ProductVariants'))
    CREATE UNIQUE INDEX UQ_ProductVariants_RetailId ON dbo.ProductVariants (RetailId) WHERE RetailId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_ProductVariants_EcwidCombinationId' AND object_id = OBJECT_ID(N'dbo.ProductVariants'))
    CREATE UNIQUE INDEX UQ_ProductVariants_EcwidCombinationId ON dbo.ProductVariants (EcwidCombinationId) WHERE EcwidCombinationId IS NOT NULL;
GO

/* A variant's option values: UOM = REAM, COLOR = WHITE, … */
IF OBJECT_ID(N'dbo.VariantOptions', N'U') IS NULL
CREATE TABLE dbo.VariantOptions (
    VariantId INT           NOT NULL CONSTRAINT FK_VariantOptions_Variants REFERENCES dbo.ProductVariants(Id) ON DELETE CASCADE,
    Name      NVARCHAR(60)  NOT NULL,
    Value     NVARCHAR(200) NOT NULL,
    SortOrder INT           NOT NULL,
    CONSTRAINT PK_VariantOptions PRIMARY KEY (VariantId, Name)
);
GO

IF OBJECT_ID(N'dbo.ProductCategories', N'U') IS NULL
CREATE TABLE dbo.ProductCategories (
    ProductId  INT NOT NULL CONSTRAINT FK_ProductCategories_Products REFERENCES dbo.Products(Id) ON DELETE CASCADE,
    CategoryId INT NOT NULL CONSTRAINT FK_ProductCategories_Categories REFERENCES dbo.Categories(Id) ON DELETE CASCADE,
    CONSTRAINT PK_ProductCategories PRIMARY KEY (ProductId, CategoryId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ProductCategories_CategoryId' AND object_id = OBJECT_ID(N'dbo.ProductCategories'))
    CREATE INDEX IX_ProductCategories_CategoryId ON dbo.ProductCategories (CategoryId);
GO

/*
  Product photos. VariantId is set when the photo belongs to one variant.
  FileKey / ThumbKey are the downloaded files, relative to MEDIA_DIR; they
  stay NULL until the importer has run with --images.
*/
IF OBJECT_ID(N'dbo.ProductImages', N'U') IS NULL
CREATE TABLE dbo.ProductImages (
    Id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductImages PRIMARY KEY,
    ProductId      INT           NOT NULL CONSTRAINT FK_ProductImages_Products REFERENCES dbo.Products(Id) ON DELETE CASCADE,
    VariantId      INT           NULL CONSTRAINT FK_ProductImages_Variants REFERENCES dbo.ProductVariants(Id),
    SortOrder      INT           NOT NULL,
    SourceUrl      VARCHAR(400)  NULL,
    ThumbSourceUrl VARCHAR(400)  NULL,
    FileKey        VARCHAR(120)  NULL,
    ThumbKey       VARCHAR(120)  NULL,
    Alt            NVARCHAR(300) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_ProductImages_Source' AND object_id = OBJECT_ID(N'dbo.ProductImages'))
    CREATE UNIQUE INDEX UQ_ProductImages_Source ON dbo.ProductImages (ProductId, SourceUrl) WHERE SourceUrl IS NOT NULL;
GO

/*
  Stock per variant. QtyOnHand can be negative, as it can in the POS.
  QtyReserved is stock promised to placed orders that have not shipped yet.
*/
IF OBJECT_ID(N'dbo.Inventory', N'U') IS NULL
CREATE TABLE dbo.Inventory (
    VariantId     INT NOT NULL CONSTRAINT PK_Inventory PRIMARY KEY CONSTRAINT FK_Inventory_Variants REFERENCES dbo.ProductVariants(Id) ON DELETE CASCADE,
    QtyOnHand     INT NOT NULL,
    QtyReserved   INT NOT NULL CONSTRAINT DF_Inventory_QtyReserved DEFAULT 0 CONSTRAINT CK_Inventory_QtyReserved CHECK (QtyReserved >= 0),
    TrackStock    BIT NOT NULL CONSTRAINT DF_Inventory_TrackStock DEFAULT 1,
    AllowBackorder BIT NOT NULL CONSTRAINT DF_Inventory_AllowBackorder DEFAULT 0,
    ReorderPoint  INT NULL
);
GO

/* Every change to stock made on the website side (orders, staff adjustments). */
IF OBJECT_ID(N'dbo.StockMovements', N'U') IS NULL
CREATE TABLE dbo.StockMovements (
    Id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StockMovements PRIMARY KEY,
    VariantId   INT           NOT NULL CONSTRAINT FK_StockMovements_Variants REFERENCES dbo.ProductVariants(Id),
    Delta       INT           NOT NULL,
    Reason      VARCHAR(20)   NOT NULL,
    OrderId     INT           NULL,
    StaffUserId INT           NULL,
    Note        NVARCHAR(300) NULL,
    At          DATETIME2(0)  NOT NULL CONSTRAINT DF_StockMovements_At DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockMovements_Variant' AND object_id = OBJECT_ID(N'dbo.StockMovements'))
    CREATE INDEX IX_StockMovements_Variant ON dbo.StockMovements (VariantId, At);
GO
