/*
  The tax set on a customer's own account.

  In Lightspeed Retail a customer can have a tax of their own: a county's
  sales tax, or one that charges nothing, such as "Florida Resellers Tax
  Exempt Certificate Holder", with a note holding the certificate number. The
  website's checkout is to charge that tax, so the importer copies it onto
  dbo.Customers. Three new columns:

    TaxRetailId   the tax's id in Lightspeed Retail (needed again when the
                  order is written back there)
    TaxName       its name, e.g. "FL - Broward"
    TaxRate       its rate as a fraction: 0.07 is 7%, 0 is tax-exempt

  All three are empty for a customer with no tax of their own; the checkout
  then charges the store's usual tax. Two columns that already exist are
  filled by the importer from now on: TaxExempt (the customer's tax charges
  nothing) and TaxId (the certificate number from the tax note).

  Nothing is filled in by this script; run the importer afterwards.

  Touches only WOODYS_IND. Safe to run again.

  Run after 005_customers_pricing.sql, as a SQL Server administrator:
    sqlcmd -E -S localhost -b -i db\009_customer_tax.sql
*/
SET QUOTED_IDENTIFIER ON;
GO
USE WOODYS_IND;
GO

IF COL_LENGTH(N'dbo.Customers', N'TaxRetailId') IS NULL
    ALTER TABLE dbo.Customers ADD
        TaxRetailId VARCHAR(40)   NULL,
        TaxName     NVARCHAR(200) NULL,
        TaxRate     DECIMAL(9,6)  NULL CONSTRAINT CK_Customers_TaxRate CHECK (TaxRate >= 0 AND TaxRate < 1);
GO
