/*
  Website customer accounts for woodyspaper.com.

  Creates the database WOODYS_IND and its tables. It does not touch WOODYS_CP
  (Counterpoint) or any other database. Safe to run again: every step checks
  whether its object already exists.

  Run as a SQL Server administrator:
    sqlcmd -E -S localhost -b -i db\001_accounts.sql
*/
-- sqlcmd turns this off by default; the filtered index below needs it on.
SET QUOTED_IDENTIFIER ON;
GO

IF DB_ID(N'WOODYS_IND') IS NULL
    CREATE DATABASE WOODYS_IND;
GO

USE WOODYS_IND;
GO

/* One row per website account. Email is stored in lower case. */
IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
CREATE TABLE dbo.Users (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    Name            NVARCHAR(100)  NOT NULL,
    Email           NVARCHAR(254)  NOT NULL CONSTRAINT UQ_Users_Email UNIQUE,
    PasswordHash    NVARCHAR(300)  NOT NULL,   -- scrypt hash, never the password
    EmailVerifiedAt DATETIME2(0)   NULL,
    CreatedAt       DATETIME2(0)   NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME()
);
GO

/* Signed-in browsers. TokenHash is SHA-256 of the cookie value. */
IF OBJECT_ID(N'dbo.Sessions', N'U') IS NULL
CREATE TABLE dbo.Sessions (
    Id        BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Sessions PRIMARY KEY,
    TokenHash BINARY(32)   NOT NULL CONSTRAINT UQ_Sessions_TokenHash UNIQUE,
    UserId    INT          NOT NULL CONSTRAINT FK_Sessions_Users REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Sessions_CreatedAt DEFAULT SYSUTCDATETIME(),
    ExpiresAt DATETIME2(0) NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Sessions_UserId' AND object_id = OBJECT_ID(N'dbo.Sessions'))
    CREATE INDEX IX_Sessions_UserId ON dbo.Sessions (UserId);
GO

/*
  Emailed one-time codes.
    verify = confirm the website account's email
    link   = prove ownership of a Lightspeed account (sent to that account's email)
    reset  = password reset
*/
IF OBJECT_ID(N'dbo.EmailCodes', N'U') IS NULL
CREATE TABLE dbo.EmailCodes (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EmailCodes PRIMARY KEY,
    UserId          INT           NOT NULL CONSTRAINT FK_EmailCodes_Users REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    Purpose         VARCHAR(10)   NOT NULL CONSTRAINT CK_EmailCodes_Purpose CHECK (Purpose IN ('verify', 'link', 'reset')),
    TargetEmail     NVARCHAR(254) NOT NULL,
    EcwidCustomerId BIGINT        NULL,      -- link codes: the Lightspeed customer being linked
    CodeHash        BINARY(32)    NOT NULL,  -- keyed hash, never the code
    Attempts        TINYINT       NOT NULL CONSTRAINT DF_EmailCodes_Attempts DEFAULT 0,
    CreatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_EmailCodes_CreatedAt DEFAULT SYSUTCDATETIME(),
    ExpiresAt       DATETIME2(0)  NOT NULL,
    UsedAt          DATETIME2(0)  NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_EmailCodes_User_Purpose' AND object_id = OBJECT_ID(N'dbo.EmailCodes'))
    CREATE INDEX IX_EmailCodes_User_Purpose ON dbo.EmailCodes (UserId, Purpose, CreatedAt DESC);
GO

/*
  A website account's Lightspeed (Ecwid) customer.
    linked = an existing Lightspeed customer, proven with an emailed code
    sso    = a store account created through the website (signed in automatically);
             EcwidCustomerId is filled in once Lightspeed has created it
*/
IF OBJECT_ID(N'dbo.LightspeedLinks', N'U') IS NULL
CREATE TABLE dbo.LightspeedLinks (
    UserId          INT           NOT NULL CONSTRAINT PK_LightspeedLinks PRIMARY KEY
                                  CONSTRAINT FK_LightspeedLinks_Users REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    Method          VARCHAR(10)   NOT NULL CONSTRAINT CK_LightspeedLinks_Method CHECK (Method IN ('linked', 'sso')),
    EcwidCustomerId BIGINT        NULL,
    LightspeedEmail NVARCHAR(254) NOT NULL,
    LinkedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_LightspeedLinks_LinkedAt DEFAULT SYSUTCDATETIME()
);
GO
/* A Lightspeed customer can belong to only one website account. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_LightspeedLinks_Customer' AND object_id = OBJECT_ID(N'dbo.LightspeedLinks'))
    CREATE UNIQUE INDEX UQ_LightspeedLinks_Customer ON dbo.LightspeedLinks (EcwidCustomerId) WHERE EcwidCustomerId IS NOT NULL;
GO

/* Failed sign-ins and code requests, counted to slow down guessing. */
IF OBJECT_ID(N'dbo.AuthAttempts', N'U') IS NULL
CREATE TABLE dbo.AuthAttempts (
    Id         BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuthAttempts PRIMARY KEY,
    Kind       VARCHAR(20)   NOT NULL,
    AttemptKey NVARCHAR(300) NOT NULL,   -- an email address or IP address
    At         DATETIME2(0)  NOT NULL CONSTRAINT DF_AuthAttempts_At DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AuthAttempts_Lookup' AND object_id = OBJECT_ID(N'dbo.AuthAttempts'))
    CREATE INDEX IX_AuthAttempts_Lookup ON dbo.AuthAttempts (Kind, AttemptKey, At);
GO
