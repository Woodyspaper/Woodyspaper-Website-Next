/*
  Lets the website email a "claim" code: the one-time code that proves a
  website account belongs to one of our customers (dbo.Customers), so the
  account can be shown that customer's prices. See src/server/customers.ts.

  dbo.EmailCodes only accepted the purposes verify, link and reset; this adds
  claim. Nothing else changes and no rows are touched.

  Until this has been run, matching still works for a customer whose website
  email is the same as the email we hold for them (no code is needed then);
  matching by a code sent to a different address does not.

  Touches only WOODYS_IND. Safe to run again.

  Run as a SQL Server administrator:
    sqlcmd -E -S localhost -b -i db\008_claim_codes.sql
*/
SET QUOTED_IDENTIFIER ON;
GO
USE WOODYS_IND;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_EmailCodes_Purpose' AND parent_object_id = OBJECT_ID(N'dbo.EmailCodes')
           AND definition NOT LIKE N'%claim%')
BEGIN
    BEGIN TRANSACTION;
    ALTER TABLE dbo.EmailCodes DROP CONSTRAINT CK_EmailCodes_Purpose;
    ALTER TABLE dbo.EmailCodes ADD CONSTRAINT CK_EmailCodes_Purpose CHECK (Purpose IN ('verify', 'link', 'reset', 'claim'));
    COMMIT;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_EmailCodes_Purpose' AND parent_object_id = OBJECT_ID(N'dbo.EmailCodes'))
    ALTER TABLE dbo.EmailCodes ADD CONSTRAINT CK_EmailCodes_Purpose CHECK (Purpose IN ('verify', 'link', 'reset', 'claim'));
GO
