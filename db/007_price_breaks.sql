/*
  Quantity breaks on price lists: "from 10 units the price is …".

  Until now a price list could hold one price per variant. Lightspeed Retail's
  price books can hold several, each for a range of quantities, so
  dbo.PriceListItems gets two columns:

    MinQty   the price applies from this many units (1 = from the first unit)
    MaxQty   …up to this many; NULL = no upper end

  and a price-list line is now identified by (price list, variant, MinQty).
  Every line already in the table becomes "from 1 unit, no upper end", which
  is exactly what it meant before, so no price changes when this is run.

  Touches only WOODYS_IND. Safe to run again.

  Run after 005_customers_pricing.sql, as a SQL Server administrator:
    sqlcmd -E -S localhost -b -i db\007_price_breaks.sql
*/
SET QUOTED_IDENTIFIER ON;
GO
USE WOODYS_IND;
GO

IF COL_LENGTH(N'dbo.PriceListItems', N'MinQty') IS NULL
    ALTER TABLE dbo.PriceListItems ADD
        MinQty INT NOT NULL CONSTRAINT DF_PriceListItems_MinQty DEFAULT 1,
        MaxQty INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_PriceListItems_Qty' AND parent_object_id = OBJECT_ID(N'dbo.PriceListItems'))
    ALTER TABLE dbo.PriceListItems ADD CONSTRAINT CK_PriceListItems_Qty CHECK (MinQty >= 1 AND (MaxQty IS NULL OR MaxQty >= MinQty));
GO

/* The key grows from (price list, variant) to (price list, variant, MinQty). */
IF (SELECT COUNT(*) FROM sys.index_columns ic
    JOIN sys.key_constraints k ON k.parent_object_id = ic.object_id AND k.unique_index_id = ic.index_id
    WHERE k.name = N'PK_PriceListItems' AND k.parent_object_id = OBJECT_ID(N'dbo.PriceListItems')) = 2
BEGIN
    BEGIN TRANSACTION;
    ALTER TABLE dbo.PriceListItems DROP CONSTRAINT PK_PriceListItems;
    ALTER TABLE dbo.PriceListItems ADD CONSTRAINT PK_PriceListItems PRIMARY KEY (PriceListId, VariantId, MinQty);
    COMMIT;
END
GO
