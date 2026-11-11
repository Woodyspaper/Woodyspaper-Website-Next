/*
  The login the website uses. It can read and write rows in WOODYS_IND and
  nothing else: no access to WOODYS_CP, no rights to change tables.

  Run after 001_accounts.sql, as a SQL Server administrator. Choose the
  password yourself and pass it on the command line (it is not stored here):

    sqlcmd -E -S localhost -b -v WEB_PASSWORD="<a long random password>" -i db\002_web_login.sql

  Then put the same password in .env.local as DB_PASSWORD (DB_USER=woodys_web).
  Running this again with a new password changes the password.
*/
USE master;
GO
IF SUSER_ID(N'woodys_web') IS NULL
    CREATE LOGIN woodys_web WITH PASSWORD = N'$(WEB_PASSWORD)', DEFAULT_DATABASE = WOODYS_IND, CHECK_POLICY = ON;
ELSE
    ALTER LOGIN woodys_web WITH PASSWORD = N'$(WEB_PASSWORD)';
GO

USE WOODYS_IND;
GO
IF DATABASE_PRINCIPAL_ID(N'woodys_web') IS NULL
    CREATE USER woodys_web FOR LOGIN woodys_web;
GO
ALTER ROLE db_datareader ADD MEMBER woodys_web;
ALTER ROLE db_datawriter ADD MEMBER woodys_web;
GO
