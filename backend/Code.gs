/**
 * ==============================================================================
 * LEND TRACKER - GOOGLE APPS SCRIPT BACKEND (API & AUTOMATIONS)
 * ==============================================================================
 *
 * This script turns your Google Sheet into a private JSON API for the Lend
 * Tracker web app, runs daily automated email reminders, and creates weekly
 * automated Google Drive backups.
 *
 * INCLUDES:
 * 1. Accrued Interest Calculation (Yearly Simple, Monthly Simple, Fixed)
 * 2. File & Receipt Uploads to Google Drive (with viewable links)
 * 3. Secure Read-Only Borrower Portal (via unguessable portal tokens)
 * 4. Loans (money lent OUT) + Borrowings (money borrowed IN)
 *
 * TIMEZONE: Asia/Kolkata (IST)
 * CURRENCY: INR (₹)
 * ==============================================================================
 */

// Global configuration constants
var TIMEZONE = "Asia/Kolkata";
var SHEET_LOANS = "Loans";
var SHEET_PAYMENTS = "Payments";
var SHEET_REMINDERS_LOG = "RemindersLog";
var SHEET_BORROWINGS = "Borrowings";
var SHEET_BORROW_PAYMENTS = "BorrowPayments";
var DRIVE_FOLDER_ATTACHMENTS = "LendTracker_Attachments";

/**
 * Helper to get or set Script Properties (Security Passcode & Settings)
 */
function getAppPasscode() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty("APP_PASSCODE") || "";
}

function getNotificationEmail() {
  var props = PropertiesService.getScriptProperties();
  var customEmail = props.getProperty("NOTIFICATION_EMAIL");
  if (customEmail && customEmail.trim() !== "") {
    return customEmail.trim();
  }
  return Session.getActiveUser().getEmail();
}

/**
 * Automatically creates and updates required sheets and columns if they do not exist.
 * Automatically migrates existing sheets to support Interest, Attachments & Borrower Portal.
 */
function ensureSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Loans Sheet
  var loansSheet = ss.getSheetByName(SHEET_LOANS);
  var loansHeaders = [
    "loan_id",
    "borrower_name",
    "amount",
    "date_given",
    "expected_return_date",
    "phone_or_email",
    "notes",
    "created_at",
    "updated_at",
    "interest_rate",
    "interest_type",
    "attachment_url",
    "portal_token"
  ];

  if (!loansSheet) {
    loansSheet = ss.insertSheet(SHEET_LOANS);
    loansSheet.appendRow(loansHeaders);
    loansSheet.getRange(1, 1, 1, loansHeaders.length).setFontWeight("bold").setBackground("#e2e8f0");
    loansSheet.setFrozenRows(1);
  } else {
    // Check if migration is needed for extra columns
    var currentCols = loansSheet.getLastColumn();
    if (currentCols < loansHeaders.length) {
      for (var c = currentCols; c < loansHeaders.length; c++) {
        loansSheet.getRange(1, c + 1).setValue(loansHeaders[c]).setFontWeight("bold").setBackground("#e2e8f0");
      }
    }
  }

  // 2. Payments Sheet
  var paymentsSheet = ss.getSheetByName(SHEET_PAYMENTS);
  var paymentsHeaders = [
    "payment_id",
    "loan_id",
    "amount",
    "payment_date",
    "notes",
    "created_at",
    "receipt_url"
  ];

  if (!paymentsSheet) {
    paymentsSheet = ss.insertSheet(SHEET_PAYMENTS);
    paymentsSheet.appendRow(paymentsHeaders);
    paymentsSheet.getRange(1, 1, 1, paymentsHeaders.length).setFontWeight("bold").setBackground("#e2e8f0");
    paymentsSheet.setFrozenRows(1);
  } else {
    var pCols = paymentsSheet.getLastColumn();
    if (pCols < paymentsHeaders.length) {
      for (var pc = pCols; pc < paymentsHeaders.length; pc++) {
        paymentsSheet.getRange(1, pc + 1).setValue(paymentsHeaders[pc]).setFontWeight("bold").setBackground("#e2e8f0");
      }
    }
  }

  // 3. RemindersLog Sheet
  var remindersSheet = ss.getSheetByName(SHEET_REMINDERS_LOG);
  if (!remindersSheet) {
    remindersSheet = ss.insertSheet(SHEET_REMINDERS_LOG);
    remindersSheet.appendRow([
      "log_id",
      "date_sent",
      "loan_id",
      "reminder_type",
      "sent_at"
    ]);
    remindersSheet.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#e2e8f0");
    remindersSheet.setFrozenRows(1);
  }

  // 4. Borrowings Sheet (money you borrowed FROM others)
  var borrowingsSheet = ss.getSheetByName(SHEET_BORROWINGS);
  var borrowingsHeaders = [
    "borrowing_id",
    "lender_name",
    "amount",
    "date_taken",
    "expected_return_date",
    "phone_or_email",
    "notes",
    "created_at",
    "updated_at",
    "interest_rate",
    "interest_type",
    "attachment_url",
    "portal_token"
  ];

  if (!borrowingsSheet) {
    borrowingsSheet = ss.insertSheet(SHEET_BORROWINGS);
    borrowingsSheet.appendRow(borrowingsHeaders);
    borrowingsSheet.getRange(1, 1, 1, borrowingsHeaders.length).setFontWeight("bold").setBackground("#fef9c3");
    borrowingsSheet.setFrozenRows(1);
  } else {
    var bCols = borrowingsSheet.getLastColumn();
    if (bCols < borrowingsHeaders.length) {
      for (var bc = bCols; bc < borrowingsHeaders.length; bc++) {
        borrowingsSheet.getRange(1, bc + 1).setValue(borrowingsHeaders[bc]).setFontWeight("bold").setBackground("#fef9c3");
      }
    }
  }

  // 5. BorrowPayments Sheet (repayments you made to lenders)
  var borrowPaymentsSheet = ss.getSheetByName(SHEET_BORROW_PAYMENTS);
  var borrowPaymentsHeaders = [
    "borrow_payment_id",
    "borrowing_id",
    "amount",
    "payment_date",
    "notes",
    "created_at",
    "receipt_url"
  ];

  if (!borrowPaymentsSheet) {
    borrowPaymentsSheet = ss.insertSheet(SHEET_BORROW_PAYMENTS);
    borrowPaymentsSheet.appendRow(borrowPaymentsHeaders);
    borrowPaymentsSheet.getRange(1, 1, 1, borrowPaymentsHeaders.length).setFontWeight("bold").setBackground("#fef9c3");
    borrowPaymentsSheet.setFrozenRows(1);
  } else {
    var bpCols = borrowPaymentsSheet.getLastColumn();
    if (bpCols < borrowPaymentsHeaders.length) {
      for (var bpc = bpCols; bpc < borrowPaymentsHeaders.length; bpc++) {
        borrowPaymentsSheet.getRange(1, bpc + 1).setValue(borrowPaymentsHeaders[bpc]).setFontWeight("bold").setBackground("#fef9c3");
      }
    }
  }
}

/**
 * One-time setup helper function.
 */
function initialSetup() {
  ensureSheets();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("APP_PASSCODE")) {
    props.setProperty("APP_PASSCODE", "LendTracker2024!");
  }
  Logger.log("Setup complete. Passcode: " + props.getProperty("APP_PASSCODE"));
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function isAuthorized(passcode) {
  var storedPasscode = getAppPasscode();
  if (!storedPasscode) return false;
  return passcode && String(passcode).trim() === storedPasscode.trim();
}

/**
 * Saves a base64 encoded file to a dedicated Google Drive folder and returns its public view link.
 */
function saveFileToDrive(base64Data, fileName, mimeType) {
  if (!base64Data) return "";
  try {
    var folders = DriveApp.getFoldersByName(DRIVE_FOLDER_ATTACHMENTS);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DRIVE_FOLDER_ATTACHMENTS);

    var cleanBase64 = base64Data;
    if (cleanBase64.indexOf("base64,") !== -1) {
      cleanBase64 = cleanBase64.split("base64,")[1];
    }

    var decodedBytes = Utilities.base64Decode(cleanBase64);
    var blob = Utilities.newBlob(decodedBytes, mimeType || "application/octet-stream", fileName || ("file_" + new Date().getTime()));
    var file = folder.createFile(blob);

    // Make viewable by anyone who holds the link
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return file.getUrl();
  } catch (err) {
    Logger.log("Error saving file to Drive: " + err.toString());
    return "";
  }
}

/**
 * GET Request Router
 * Handles:
 * - action=ping
 * - action=getData
 * - action=getPortalData (PUBLIC FOR BORROWER WITH VALID PORTAL TOKEN)
 */
function doGet(e) {
  try {
    ensureSheets();
    var params = e ? e.parameter : {};
    var action = params.action || "ping";

    // BORROWER READ-ONLY PORTAL (No admin passcode needed, secured by unique token)
    if (action === "getPortalData") {
      var token = params.token || "";
      if (!token) {
        return createJsonResponse({ success: false, error: "Missing portal token." });
      }
      return createJsonResponse(handleGetPortalData(token));
    }

    // Admin endpoints require passcode
    var passcode = params.passcode || "";
    if (!isAuthorized(passcode)) {
      return createJsonResponse({
        success: false,
        error: "Unauthorized: Invalid or missing passcode."
      });
    }

    if (action === "ping") {
      return createJsonResponse({
        success: true,
        message: "Lend Tracker API connected successfully",
        serverTime: Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss")
      });
    }

    if (action === "getData") {
      var allData = fetchAllData();
      return createJsonResponse({
        success: true,
        data: allData
      });
    }

    return createJsonResponse({
      success: false,
      error: "Unknown action: " + action
    });
  } catch (err) {
    return createJsonResponse({
      success: false,
      error: err.toString()
    });
  }
}

/**
 * POST Request Router
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (lockErr) {
    return createJsonResponse({
      success: false,
      error: "Server is busy. Please try again in a few moments."
    });
  }

  try {
    ensureSheets();

    var payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        return createJsonResponse({
          success: false,
          error: "Invalid JSON payload in request."
        });
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    var passcode = payload.passcode || "";
    if (!isAuthorized(passcode)) {
      return createJsonResponse({
        success: false,
        error: "Unauthorized: Invalid or missing passcode."
      });
    }

    var action = payload.action;
    var data = payload.data || {};

    switch (action) {
      case "addLoan":
        return createJsonResponse(handleAddLoan(data));
      case "updateLoan":
        return createJsonResponse(handleUpdateLoan(data));
      case "deleteLoan":
        return createJsonResponse(handleDeleteLoan(data));
      case "addPayment":
        return createJsonResponse(handleAddPayment(data));
      case "deletePayment":
        return createJsonResponse(handleDeletePayment(data));
      // --- Borrowings (money borrowed FROM others) ---
      case "addBorrowing":
        return createJsonResponse(handleAddBorrowing(data));
      case "updateBorrowing":
        return createJsonResponse(handleUpdateBorrowing(data));
      case "deleteBorrowing":
        return createJsonResponse(handleDeleteBorrowing(data));
      case "addBorrowPayment":
        return createJsonResponse(handleAddBorrowPayment(data));
      case "deleteBorrowPayment":
        return createJsonResponse(handleDeleteBorrowPayment(data));
      default:
        return createJsonResponse({
          success: false,
          error: "Unsupported action: " + action
        });
    }
  } catch (err) {
    return createJsonResponse({
      success: false,
      error: err.toString()
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Accrued Interest Calculation Helper
 * Supports:
 * - 'none' / 0%: No interest
 * - 'simple_yearly': % p.a. -> P * (R/100) * (days/365.25)
 * - 'simple_monthly': % p.m. -> P * (R/100) * (days/30.4375)
 * - 'fixed_amount': A flat fixed fee
 */
function computeAccruedInterest(principal, rate, type, dateGivenStr, endDateStr) {
  principal = Number(principal) || 0;
  rate = Number(rate) || 0;
  if (!rate || rate <= 0 || !type || type === "none" || !dateGivenStr) {
    return 0;
  }

  if (type === "fixed_amount") {
    return Math.round(rate * 100) / 100;
  }

  var d1 = new Date(dateGivenStr);
  var d2 = new Date(endDateStr || Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd"));
  var diffTime = d2.getTime() - d1.getTime();
  var days = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

  var interest = 0;
  if (type === "simple_yearly") {
    interest = principal * (rate / 100) * (days / 365.25);
  } else if (type === "simple_monthly") {
    interest = principal * (rate / 100) * (days / 30.4375);
  }

  return Math.round(interest * 100) / 100;
}

/**
 * Fetches all loans, payments, borrowings, borrow_payments, calculates interest,
 * remaining balances, and statuses. Returns combined data object.
 */
function fetchAllData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var loansSheet = ss.getSheetByName(SHEET_LOANS);
  var paymentsSheet = ss.getSheetByName(SHEET_PAYMENTS);
  var borrowingsSheet = ss.getSheetByName(SHEET_BORROWINGS);
  var borrowPaymentsSheet = ss.getSheetByName(SHEET_BORROW_PAYMENTS);

  var loansRaw = loansSheet.getDataRange().getValues();
  var paymentsRaw = paymentsSheet.getDataRange().getValues();
  var borrowingsRaw = borrowingsSheet ? borrowingsSheet.getDataRange().getValues() : [[]];
  var borrowPaymentsRaw = borrowPaymentsSheet ? borrowPaymentsSheet.getDataRange().getValues() : [[]];
  var todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");

  // ---- Process Loan Payments ----
  var paymentsByLoan = {};
  var allPaymentsList = [];

  if (paymentsRaw.length > 1) {
    for (var p = 1; p < paymentsRaw.length; p++) {
      var pRow = paymentsRaw[p];
      if (!pRow[0]) continue;

      var pDate = pRow[3];
      var formattedPDate = "";
      if (pDate instanceof Date) {
        formattedPDate = Utilities.formatDate(pDate, TIMEZONE, "yyyy-MM-dd");
      } else if (pDate) {
        formattedPDate = String(pDate).trim().substring(0, 10);
      }

      var paymentObj = {
        payment_id: String(pRow[0]),
        loan_id: String(pRow[1]),
        amount: Number(pRow[2]) || 0,
        payment_date: formattedPDate,
        notes: String(pRow[4] || ""),
        created_at: String(pRow[5] || ""),
        receipt_url: String(pRow[6] || "")
      };

      allPaymentsList.push(paymentObj);
      if (!paymentsByLoan[paymentObj.loan_id]) {
        paymentsByLoan[paymentObj.loan_id] = [];
      }
      paymentsByLoan[paymentObj.loan_id].push(paymentObj);
    }
  }

  // ---- Process Loans ----
  var loansList = [];
  var totalLent = 0;
  var totalReceived = 0;
  var statusCounts = { all: 0, pending: 0, partial: 0, completed: 0, overdue: 0 };

  if (loansRaw.length > 1) {
    for (var l = 1; l < loansRaw.length; l++) {
      var lRow = loansRaw[l];
      if (!lRow[0]) continue;

      var loanId = String(lRow[0]);
      var principalAmount = Number(lRow[2]) || 0;

      var dateGiven = lRow[3];
      var dateGivenStr = (dateGiven instanceof Date)
        ? Utilities.formatDate(dateGiven, TIMEZONE, "yyyy-MM-dd")
        : String(dateGiven || "").trim().substring(0, 10);

      var returnDate = lRow[4];
      var returnDateStr = (returnDate instanceof Date)
        ? Utilities.formatDate(returnDate, TIMEZONE, "yyyy-MM-dd")
        : String(returnDate || "").trim().substring(0, 10);

      var interestRate = Number(lRow[9]) || 0;
      var interestType = String(lRow[10] || "none").trim();
      var attachmentUrl = String(lRow[11] || "").trim();
      var portalToken = String(lRow[12] || "").trim();

      // If portal token is missing (from earlier creation), generate one on the fly
      if (!portalToken) {
        portalToken = "port_" + Utilities.getUuid().replace(/-/g, "").substring(0, 16);
        loansSheet.getRange(l + 1, 13).setValue(portalToken);
      }

      var loanPayments = paymentsByLoan[loanId] || [];
      loanPayments.sort(function(a, b) {
        return (b.payment_date || "").localeCompare(a.payment_date || "");
      });

      var totalPaid = 0;
      for (var k = 0; k < loanPayments.length; k++) {
        totalPaid += loanPayments[k].amount;
      }
      totalPaid = Math.round(totalPaid * 100) / 100;

      // Accrued Interest
      var accruedInterest = computeAccruedInterest(principalAmount, interestRate, interestType, dateGivenStr, todayStr);
      var totalPayable = Math.round((principalAmount + accruedInterest) * 100) / 100;
      var remainingBalance = Math.max(0, Math.round((totalPayable - totalPaid) * 100) / 100);

      var status = "Pending";
      if (remainingBalance <= 0) {
        status = "Completed";
      } else if (totalPaid > 0) {
        status = "Partial";
      } else {
        status = "Pending";
      }

      var isOverdue = false;
      var daysDiff = null;
      if (status !== "Completed" && returnDateStr) {
        var diffTime = new Date(returnDateStr).getTime() - new Date(todayStr).getTime();
        daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (daysDiff < 0) {
          isOverdue = true;
        }
      }

      totalLent += principalAmount;
      totalReceived += totalPaid;
      statusCounts.all++;
      if (status === "Completed") statusCounts.completed++;
      else if (status === "Partial") statusCounts.partial++;
      else statusCounts.pending++;
      if (isOverdue) statusCounts.overdue++;

      loansList.push({
        loan_id: loanId,
        borrower_name: String(lRow[1] || "").trim(),
        amount: principalAmount,
        date_given: dateGivenStr,
        expected_return_date: returnDateStr,
        phone_or_email: String(lRow[5] || "").trim(),
        notes: String(lRow[6] || "").trim(),
        created_at: String(lRow[7] || ""),
        updated_at: String(lRow[8] || ""),
        interest_rate: interestRate,
        interest_type: interestType,
        accrued_interest: accruedInterest,
        total_payable: totalPayable,
        total_paid: totalPaid,
        remaining_balance: remainingBalance,
        status: status,
        is_overdue: isOverdue,
        days_until_due: daysDiff,
        attachment_url: attachmentUrl,
        portal_token: portalToken,
        payments: loanPayments
      });
    }
  }

  loansList.sort(function(a, b) {
    return (b.date_given || "").localeCompare(a.date_given || "");
  });

  // ---- Process BorrowPayments ----
  var borrowPaymentsByBorrowing = {};
  var allBorrowPaymentsList = [];

  if (borrowPaymentsRaw.length > 1) {
    for (var bp = 1; bp < borrowPaymentsRaw.length; bp++) {
      var bpRow = borrowPaymentsRaw[bp];
      if (!bpRow[0]) continue;

      var bpDate = bpRow[3];
      var formattedBpDate = "";
      if (bpDate instanceof Date) {
        formattedBpDate = Utilities.formatDate(bpDate, TIMEZONE, "yyyy-MM-dd");
      } else if (bpDate) {
        formattedBpDate = String(bpDate).trim().substring(0, 10);
      }

      var bpObj = {
        borrow_payment_id: String(bpRow[0]),
        borrowing_id: String(bpRow[1]),
        amount: Number(bpRow[2]) || 0,
        payment_date: formattedBpDate,
        notes: String(bpRow[4] || ""),
        created_at: String(bpRow[5] || ""),
        receipt_url: String(bpRow[6] || "")
      };

      allBorrowPaymentsList.push(bpObj);
      if (!borrowPaymentsByBorrowing[bpObj.borrowing_id]) {
        borrowPaymentsByBorrowing[bpObj.borrowing_id] = [];
      }
      borrowPaymentsByBorrowing[bpObj.borrowing_id].push(bpObj);
    }
  }

  // ---- Process Borrowings ----
  var borrowingsList = [];
  var totalBorrowed = 0;
  var totalRepaid = 0;
  var borrowStatusCounts = { all: 0, pending: 0, partial: 0, completed: 0, overdue: 0 };

  if (borrowingsRaw.length > 1) {
    for (var b = 1; b < borrowingsRaw.length; b++) {
      var bRow = borrowingsRaw[b];
      if (!bRow[0]) continue;

      var borrowingId = String(bRow[0]);
      var bPrincipal = Number(bRow[2]) || 0;

      var bDateTaken = bRow[3];
      var bDateTakenStr = (bDateTaken instanceof Date)
        ? Utilities.formatDate(bDateTaken, TIMEZONE, "yyyy-MM-dd")
        : String(bDateTaken || "").trim().substring(0, 10);

      var bReturnDate = bRow[4];
      var bReturnDateStr = (bReturnDate instanceof Date)
        ? Utilities.formatDate(bReturnDate, TIMEZONE, "yyyy-MM-dd")
        : String(bReturnDate || "").trim().substring(0, 10);

      var bInterestRate = Number(bRow[9]) || 0;
      var bInterestType = String(bRow[10] || "none").trim();
      var bAttachmentUrl = String(bRow[11] || "").trim();
      var bPortalToken = String(bRow[12] || "").trim();

      // Generate portal token on the fly if missing
      if (!bPortalToken) {
        bPortalToken = "bport_" + Utilities.getUuid().replace(/-/g, "").substring(0, 16);
        borrowingsSheet.getRange(b + 1, 13).setValue(bPortalToken);
      }

      var bPayments = borrowPaymentsByBorrowing[borrowingId] || [];
      bPayments.sort(function(a, b) {
        return (b.payment_date || "").localeCompare(a.payment_date || "");
      });

      var bTotalRepaid = 0;
      for (var bk = 0; bk < bPayments.length; bk++) {
        bTotalRepaid += bPayments[bk].amount;
      }
      bTotalRepaid = Math.round(bTotalRepaid * 100) / 100;

      var bAccruedInterest = computeAccruedInterest(bPrincipal, bInterestRate, bInterestType, bDateTakenStr, todayStr);
      var bTotalPayable = Math.round((bPrincipal + bAccruedInterest) * 100) / 100;
      var bRemainingBalance = Math.max(0, Math.round((bTotalPayable - bTotalRepaid) * 100) / 100);

      var bStatus = "Pending";
      if (bRemainingBalance <= 0) {
        bStatus = "Completed";
      } else if (bTotalRepaid > 0) {
        bStatus = "Partial";
      } else {
        bStatus = "Pending";
      }

      var bIsOverdue = false;
      var bDaysDiff = null;
      if (bStatus !== "Completed" && bReturnDateStr) {
        var bDiffTime = new Date(bReturnDateStr).getTime() - new Date(todayStr).getTime();
        bDaysDiff = Math.ceil(bDiffTime / (1000 * 60 * 60 * 24));
        if (bDaysDiff < 0) {
          bIsOverdue = true;
        }
      }

      totalBorrowed += bPrincipal;
      totalRepaid += bTotalRepaid;
      borrowStatusCounts.all++;
      if (bStatus === "Completed") borrowStatusCounts.completed++;
      else if (bStatus === "Partial") borrowStatusCounts.partial++;
      else borrowStatusCounts.pending++;
      if (bIsOverdue) borrowStatusCounts.overdue++;

      borrowingsList.push({
        borrowing_id: borrowingId,
        lender_name: String(bRow[1] || "").trim(),
        amount: bPrincipal,
        date_taken: bDateTakenStr,
        expected_return_date: bReturnDateStr,
        phone_or_email: String(bRow[5] || "").trim(),
        notes: String(bRow[6] || "").trim(),
        created_at: String(bRow[7] || ""),
        updated_at: String(bRow[8] || ""),
        interest_rate: bInterestRate,
        interest_type: bInterestType,
        accrued_interest: bAccruedInterest,
        total_payable: bTotalPayable,
        total_repaid: bTotalRepaid,
        remaining_balance: bRemainingBalance,
        status: bStatus,
        is_overdue: bIsOverdue,
        days_until_due: bDaysDiff,
        attachment_url: bAttachmentUrl,
        portal_token: bPortalToken,
        payments: bPayments
      });
    }
  }

  borrowingsList.sort(function(a, b) {
    return (b.date_taken || "").localeCompare(a.date_taken || "");
  });

  return {
    loans: loansList,
    payments: allPaymentsList,
    summary: {
      total_lent: Math.round(totalLent * 100) / 100,
      total_received: Math.round(totalReceived * 100) / 100,
      total_outstanding: Math.max(0, Math.round((totalLent - totalReceived) * 100) / 100),
      counts: statusCounts,
      today: todayStr
    },
    borrowings: borrowingsList,
    borrow_payments: allBorrowPaymentsList,
    borrow_summary: {
      total_borrowed: Math.round(totalBorrowed * 100) / 100,
      total_repaid: Math.round(totalRepaid * 100) / 100,
      total_outstanding: Math.max(0, Math.round((totalBorrowed - totalRepaid) * 100) / 100),
      counts: borrowStatusCounts,
      today: todayStr
    }
  };
}

/**
 * Adds a new loan record (with Interest, File Attachment & Portal Token)
 */
function handleAddLoan(data) {
  var borrower = (data.borrower_name || "").toString().trim();
  var amount = Number(data.amount);
  var dateGiven = (data.date_given || "").toString().trim();
  var expectedReturnDate = (data.expected_return_date || "").toString().trim();
  var contact = (data.phone_or_email || "").toString().trim();
  var notes = (data.notes || "").toString().trim();
  var interestRate = Number(data.interest_rate) || 0;
  var interestType = (data.interest_type || "none").toString().trim();

  if (!borrower) return { success: false, error: "Borrower name is required." };
  if (!amount || isNaN(amount) || amount <= 0) return { success: false, error: "Amount must be a positive number." };
  if (!dateGiven) dateGiven = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");

  // Handle optional file upload to Google Drive
  var attachmentUrl = "";
  if (data.fileData && data.fileName) {
    attachmentUrl = saveFileToDrive(data.fileData, data.fileName, data.mimeType);
  } else if (data.attachment_url) {
    attachmentUrl = data.attachment_url;
  }

  var nowIso = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'Z'");
  var loanId = "loan_" + new Date().getTime() + "_" + Math.floor(Math.random() * 10000);
  var portalToken = "port_" + Utilities.getUuid().replace(/-/g, "").substring(0, 16);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_LOANS);

  sheet.appendRow([
    loanId,
    borrower,
    amount,
    dateGiven,
    expectedReturnDate,
    contact,
    notes,
    nowIso,
    nowIso,
    interestRate,
    interestType,
    attachmentUrl,
    portalToken
  ]);

  return {
    success: true,
    loan_id: loanId,
    portal_token: portalToken,
    attachment_url: attachmentUrl,
    message: "Loan added successfully."
  };
}

/**
 * Updates an existing loan
 */
function handleUpdateLoan(data) {
  var loanId = (data.loan_id || "").toString().trim();
  if (!loanId) return { success: false, error: "Loan ID is required." };

  var borrower = (data.borrower_name || "").toString().trim();
  var amount = Number(data.amount);
  var dateGiven = (data.date_given || "").toString().trim();
  var expectedReturnDate = (data.expected_return_date || "").toString().trim();
  var contact = (data.phone_or_email || "").toString().trim();
  var notes = (data.notes || "").toString().trim();
  var interestRate = Number(data.interest_rate) || 0;
  var interestType = (data.interest_type || "none").toString().trim();

  if (!borrower) return { success: false, error: "Borrower name is required." };
  if (!amount || isNaN(amount) || amount <= 0) return { success: false, error: "Amount must be a positive number." };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_LOANS);
  var values = sheet.getDataRange().getValues();

  var rowIndex = -1;
  var existingAttachment = "";
  var existingToken = "";
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === loanId) {
      rowIndex = i + 1;
      existingAttachment = String(values[i][11] || "");
      existingToken = String(values[i][12] || "");
      break;
    }
  }

  if (rowIndex === -1) return { success: false, error: "Loan not found." };

  var attachmentUrl = existingAttachment;
  if (data.fileData && data.fileName) {
    attachmentUrl = saveFileToDrive(data.fileData, data.fileName, data.mimeType);
  }

  var portalToken = existingToken || ("port_" + Utilities.getUuid().replace(/-/g, "").substring(0, 16));
  var nowIso = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'Z'");

  sheet.getRange(rowIndex, 2).setValue(borrower);
  sheet.getRange(rowIndex, 3).setValue(amount);
  sheet.getRange(rowIndex, 4).setValue(dateGiven);
  sheet.getRange(rowIndex, 5).setValue(expectedReturnDate);
  sheet.getRange(rowIndex, 6).setValue(contact);
  sheet.getRange(rowIndex, 7).setValue(notes);
  sheet.getRange(rowIndex, 9).setValue(nowIso);
  sheet.getRange(rowIndex, 10).setValue(interestRate);
  sheet.getRange(rowIndex, 11).setValue(interestType);
  sheet.getRange(rowIndex, 12).setValue(attachmentUrl);
  sheet.getRange(rowIndex, 13).setValue(portalToken);

  return { success: true, message: "Loan updated successfully." };
}

function handleDeleteLoan(data) {
  var loanId = (data.loan_id || "").toString().trim();
  if (!loanId) return { success: false, error: "Loan ID is required." };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var loansSheet = ss.getSheetByName(SHEET_LOANS);
  var paymentsSheet = ss.getSheetByName(SHEET_PAYMENTS);

  var loanValues = loansSheet.getDataRange().getValues();
  for (var i = loanValues.length - 1; i >= 1; i--) {
    if (String(loanValues[i][0]) === loanId) {
      loansSheet.deleteRow(i + 1);
      break;
    }
  }

  var paymentValues = paymentsSheet.getDataRange().getValues();
  for (var j = paymentValues.length - 1; j >= 1; j--) {
    if (String(paymentValues[j][1]) === loanId) {
      paymentsSheet.deleteRow(j + 1);
    }
  }

  return { success: true, message: "Loan and related payments removed." };
}

/**
 * Adds a payment to a loan with receipt file upload
 */
function handleAddPayment(data) {
  var loanId = (data.loan_id || "").toString().trim();
  var amount = Number(data.amount);
  var paymentDate = (data.payment_date || "").toString().trim();
  var notes = (data.notes || "").toString().trim();

  if (!loanId) return { success: false, error: "Loan ID is required." };
  if (!amount || isNaN(amount) || amount <= 0) return { success: false, error: "Payment amount must be greater than 0." };
  if (!paymentDate) paymentDate = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var loansSheet = ss.getSheetByName(SHEET_LOANS);
  var paymentsSheet = ss.getSheetByName(SHEET_PAYMENTS);

  var loanValues = loansSheet.getDataRange().getValues();
  var loanRow = null;
  for (var i = 1; i < loanValues.length; i++) {
    if (String(loanValues[i][0]) === loanId) {
      loanRow = loanValues[i];
      break;
    }
  }

  if (!loanRow) return { success: false, error: "Loan not found." };

  var principalAmount = Number(loanRow[2]) || 0;
  var dateGiven = loanRow[3];
  var dateGivenStr = (dateGiven instanceof Date) ? Utilities.formatDate(dateGiven, TIMEZONE, "yyyy-MM-dd") : String(dateGiven || "").substring(0, 10);
  var interestRate = Number(loanRow[9]) || 0;
  var interestType = String(loanRow[10] || "none").trim();

  var paymentValues = paymentsSheet.getDataRange().getValues();
  var totalAlreadyPaid = 0;
  for (var p = 1; p < paymentValues.length; p++) {
    if (String(paymentValues[p][1]) === loanId) {
      totalAlreadyPaid += Number(paymentValues[p][2]) || 0;
    }
  }

  var todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  var accruedInterest = computeAccruedInterest(principalAmount, interestRate, interestType, dateGivenStr, todayStr);
  var totalPayable = principalAmount + accruedInterest;
  var currentBalance = Math.round((totalPayable - totalAlreadyPaid) * 100) / 100;

  if (amount > (currentBalance + 0.05)) {
    return {
      success: false,
      error: "Payment (₹" + amount + ") exceeds remaining balance (₹" + currentBalance + ")."
    };
  }

  var receiptUrl = "";
  if (data.fileData && data.fileName) {
    receiptUrl = saveFileToDrive(data.fileData, data.fileName, data.mimeType);
  }

  var paymentId = "pay_" + new Date().getTime() + "_" + Math.floor(Math.random() * 10000);
  var nowIso = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'Z'");

  paymentsSheet.appendRow([
    paymentId,
    loanId,
    amount,
    paymentDate,
    notes,
    nowIso,
    receiptUrl
  ]);

  return {
    success: true,
    payment_id: paymentId,
    receipt_url: receiptUrl,
    message: "Payment recorded successfully."
  };
}

function handleDeletePayment(data) {
  var paymentId = (data.payment_id || "").toString().trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var paymentsSheet = ss.getSheetByName(SHEET_PAYMENTS);
  var values = paymentsSheet.getDataRange().getValues();

  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === paymentId) {
      paymentsSheet.deleteRow(i + 1);
      return { success: true, message: "Payment removed." };
    }
  }
  return { success: false, error: "Payment not found." };
}

// ==============================================================================
// BORROWINGS HANDLERS (money borrowed FROM others — you need to repay)
// ==============================================================================

/**
 * Adds a new borrowing record (money you received from a lender)
 */
function handleAddBorrowing(data) {
  var lenderName = (data.lender_name || "").toString().trim();
  var amount = Number(data.amount);
  var dateTaken = (data.date_taken || "").toString().trim();
  var expectedReturnDate = (data.expected_return_date || "").toString().trim();
  var contact = (data.phone_or_email || "").toString().trim();
  var notes = (data.notes || "").toString().trim();
  var interestRate = Number(data.interest_rate) || 0;
  var interestType = (data.interest_type || "none").toString().trim();

  if (!lenderName) return { success: false, error: "Lender name is required." };
  if (!amount || isNaN(amount) || amount <= 0) return { success: false, error: "Amount must be a positive number." };
  if (!dateTaken) dateTaken = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");

  // Handle optional file upload to Google Drive
  var attachmentUrl = "";
  if (data.fileData && data.fileName) {
    attachmentUrl = saveFileToDrive(data.fileData, data.fileName, data.mimeType);
  } else if (data.attachment_url) {
    attachmentUrl = data.attachment_url;
  }

  var nowIso = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'Z'");
  var borrowingId = "borrow_" + new Date().getTime() + "_" + Math.floor(Math.random() * 10000);
  var portalToken = "bport_" + Utilities.getUuid().replace(/-/g, "").substring(0, 16);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_BORROWINGS);

  sheet.appendRow([
    borrowingId,
    lenderName,
    amount,
    dateTaken,
    expectedReturnDate,
    contact,
    notes,
    nowIso,
    nowIso,
    interestRate,
    interestType,
    attachmentUrl,
    portalToken
  ]);

  return {
    success: true,
    borrowing_id: borrowingId,
    portal_token: portalToken,
    attachment_url: attachmentUrl,
    message: "Borrowing added successfully."
  };
}

/**
 * Updates an existing borrowing record
 */
function handleUpdateBorrowing(data) {
  var borrowingId = (data.borrowing_id || "").toString().trim();
  if (!borrowingId) return { success: false, error: "Borrowing ID is required." };

  var lenderName = (data.lender_name || "").toString().trim();
  var amount = Number(data.amount);
  var dateTaken = (data.date_taken || "").toString().trim();
  var expectedReturnDate = (data.expected_return_date || "").toString().trim();
  var contact = (data.phone_or_email || "").toString().trim();
  var notes = (data.notes || "").toString().trim();
  var interestRate = Number(data.interest_rate) || 0;
  var interestType = (data.interest_type || "none").toString().trim();

  if (!lenderName) return { success: false, error: "Lender name is required." };
  if (!amount || isNaN(amount) || amount <= 0) return { success: false, error: "Amount must be a positive number." };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_BORROWINGS);
  var values = sheet.getDataRange().getValues();

  var rowIndex = -1;
  var existingAttachment = "";
  var existingToken = "";
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === borrowingId) {
      rowIndex = i + 1;
      existingAttachment = String(values[i][11] || "");
      existingToken = String(values[i][12] || "");
      break;
    }
  }

  if (rowIndex === -1) return { success: false, error: "Borrowing not found." };

  var attachmentUrl = existingAttachment;
  if (data.fileData && data.fileName) {
    attachmentUrl = saveFileToDrive(data.fileData, data.fileName, data.mimeType);
  }

  var portalToken = existingToken || ("bport_" + Utilities.getUuid().replace(/-/g, "").substring(0, 16));
  var nowIso = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'Z'");

  sheet.getRange(rowIndex, 2).setValue(lenderName);
  sheet.getRange(rowIndex, 3).setValue(amount);
  sheet.getRange(rowIndex, 4).setValue(dateTaken);
  sheet.getRange(rowIndex, 5).setValue(expectedReturnDate);
  sheet.getRange(rowIndex, 6).setValue(contact);
  sheet.getRange(rowIndex, 7).setValue(notes);
  sheet.getRange(rowIndex, 9).setValue(nowIso);
  sheet.getRange(rowIndex, 10).setValue(interestRate);
  sheet.getRange(rowIndex, 11).setValue(interestType);
  sheet.getRange(rowIndex, 12).setValue(attachmentUrl);
  sheet.getRange(rowIndex, 13).setValue(portalToken);

  return { success: true, message: "Borrowing updated successfully." };
}

/**
 * Deletes a borrowing record and cascades to delete all associated borrow payments
 */
function handleDeleteBorrowing(data) {
  var borrowingId = (data.borrowing_id || "").toString().trim();
  if (!borrowingId) return { success: false, error: "Borrowing ID is required." };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var borrowingsSheet = ss.getSheetByName(SHEET_BORROWINGS);
  var borrowPaymentsSheet = ss.getSheetByName(SHEET_BORROW_PAYMENTS);

  var borrowingValues = borrowingsSheet.getDataRange().getValues();
  for (var i = borrowingValues.length - 1; i >= 1; i--) {
    if (String(borrowingValues[i][0]) === borrowingId) {
      borrowingsSheet.deleteRow(i + 1);
      break;
    }
  }

  // Cascade delete associated borrow payments
  var borrowPaymentValues = borrowPaymentsSheet.getDataRange().getValues();
  for (var j = borrowPaymentValues.length - 1; j >= 1; j--) {
    if (String(borrowPaymentValues[j][1]) === borrowingId) {
      borrowPaymentsSheet.deleteRow(j + 1);
    }
  }

  return { success: true, message: "Borrowing and related payments removed." };
}

/**
 * Records a repayment you made to a lender (with receipt file upload & balance validation)
 */
function handleAddBorrowPayment(data) {
  var borrowingId = (data.borrowing_id || "").toString().trim();
  var amount = Number(data.amount);
  var paymentDate = (data.payment_date || "").toString().trim();
  var notes = (data.notes || "").toString().trim();

  if (!borrowingId) return { success: false, error: "Borrowing ID is required." };
  if (!amount || isNaN(amount) || amount <= 0) return { success: false, error: "Payment amount must be greater than 0." };
  if (!paymentDate) paymentDate = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var borrowingsSheet = ss.getSheetByName(SHEET_BORROWINGS);
  var borrowPaymentsSheet = ss.getSheetByName(SHEET_BORROW_PAYMENTS);

  var borrowingValues = borrowingsSheet.getDataRange().getValues();
  var borrowingRow = null;
  for (var i = 1; i < borrowingValues.length; i++) {
    if (String(borrowingValues[i][0]) === borrowingId) {
      borrowingRow = borrowingValues[i];
      break;
    }
  }

  if (!borrowingRow) return { success: false, error: "Borrowing not found." };

  var principalAmount = Number(borrowingRow[2]) || 0;
  var dateTaken = borrowingRow[3];
  var dateTakenStr = (dateTaken instanceof Date) ? Utilities.formatDate(dateTaken, TIMEZONE, "yyyy-MM-dd") : String(dateTaken || "").substring(0, 10);
  var interestRate = Number(borrowingRow[9]) || 0;
  var interestType = String(borrowingRow[10] || "none").trim();

  var existingPayments = borrowPaymentsSheet.getDataRange().getValues();
  var totalAlreadyRepaid = 0;
  for (var p = 1; p < existingPayments.length; p++) {
    if (String(existingPayments[p][1]) === borrowingId) {
      totalAlreadyRepaid += Number(existingPayments[p][2]) || 0;
    }
  }

  var todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  var accruedInterest = computeAccruedInterest(principalAmount, interestRate, interestType, dateTakenStr, todayStr);
  var totalPayable = principalAmount + accruedInterest;
  var currentBalance = Math.round((totalPayable - totalAlreadyRepaid) * 100) / 100;

  if (amount > (currentBalance + 0.05)) {
    return {
      success: false,
      error: "Payment (₹" + amount + ") exceeds remaining balance (₹" + currentBalance + ")."
    };
  }

  var receiptUrl = "";
  if (data.fileData && data.fileName) {
    receiptUrl = saveFileToDrive(data.fileData, data.fileName, data.mimeType);
  }

  var borrowPaymentId = "bpay_" + new Date().getTime() + "_" + Math.floor(Math.random() * 10000);
  var nowIso = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'Z'");

  borrowPaymentsSheet.appendRow([
    borrowPaymentId,
    borrowingId,
    amount,
    paymentDate,
    notes,
    nowIso,
    receiptUrl
  ]);

  return {
    success: true,
    borrow_payment_id: borrowPaymentId,
    receipt_url: receiptUrl,
    message: "Borrow payment recorded successfully."
  };
}

/**
 * Deletes a borrow payment record
 */
function handleDeleteBorrowPayment(data) {
  var borrowPaymentId = (data.borrow_payment_id || "").toString().trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var borrowPaymentsSheet = ss.getSheetByName(SHEET_BORROW_PAYMENTS);
  var values = borrowPaymentsSheet.getDataRange().getValues();

  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === borrowPaymentId) {
      borrowPaymentsSheet.deleteRow(i + 1);
      return { success: true, message: "Borrow payment removed." };
    }
  }
  return { success: false, error: "Borrow payment not found." };
}

/**
 * ==============================================================================
 * BORROWER/LENDER PORTAL PUBLIC FETCHER (Secured by unguessable portal token)
 * Works for both Loan portal tokens (port_...) and Borrowing portal tokens (bport_...)
 * ==============================================================================
 */
function handleGetPortalData(portalToken) {
  var allData = fetchAllData();
  var props = PropertiesService.getScriptProperties();

  // Check Loans first (portal tokens starting with "port_")
  var loans = allData.loans;
  for (var i = 0; i < loans.length; i++) {
    if (loans[i].portal_token === portalToken) {
      return {
        success: true,
        type: "loan",
        data: {
          loan: loans[i],
          lender_name: props.getProperty("LENDER_NAME") || "Personal Lender",
          lender_upi: props.getProperty("UPI_ID") || ""
        }
      };
    }
  }

  // Check Borrowings (portal tokens starting with "bport_")
  var borrowings = allData.borrowings;
  for (var j = 0; j < borrowings.length; j++) {
    if (borrowings[j].portal_token === portalToken) {
      return {
        success: true,
        type: "borrowing",
        data: {
          borrowing: borrowings[j],
          lender_name: props.getProperty("LENDER_NAME") || "Personal Lender",
          lender_upi: props.getProperty("UPI_ID") || ""
        }
      };
    }
  }

  return { success: false, error: "Record not found or link has expired." };
}

/**
 * ==============================================================================
 * AUTOMATED TIME-DRIVEN REMINDERS
 * Checks both Loans (money to receive back) and Borrowings (money you need to return)
 * ==============================================================================
 */
function sendDailyDueDateReminders() {
  ensureSheets();
  var dataObj = fetchAllData();
  var loans = dataObj.loans;
  var borrowings = dataObj.borrowings;
  var todayStr = dataObj.summary.today;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName(SHEET_REMINDERS_LOG);
  var logValues = logSheet.getDataRange().getValues();

  var sentTodaySet = {};
  for (var r = 1; r < logValues.length; r++) {
    var rDate = logValues[r][1];
    var rDateStr = (rDate instanceof Date) ? Utilities.formatDate(rDate, TIMEZONE, "yyyy-MM-dd") : String(rDate);
    var rLoanId = String(logValues[r][2]);
    var rType = String(logValues[r][3]);
    if (rDateStr === todayStr) {
      sentTodaySet[rDateStr + "_" + rLoanId + "_" + rType] = true;
    }
  }

  // ---- Process Loan reminders (money lent OUT, awaiting repayment) ----
  var dueTodayList = [];
  var dueIn1DayList = [];
  var dueIn3DaysList = [];
  var overdueList = [];
  var logsToAppend = [];

  for (var i = 0; i < loans.length; i++) {
    var loan = loans[i];
    if (loan.status === "Completed" || !loan.expected_return_date) continue;

    var daysUntilDue = loan.days_until_due;
    if (daysUntilDue === 0) {
      var key0 = todayStr + "_" + loan.loan_id + "_DUE_TODAY";
      if (!sentTodaySet[key0]) {
        dueTodayList.push(loan);
        logsToAppend.push(["log_" + new Date().getTime() + "_" + i, todayStr, loan.loan_id, "DUE_TODAY", new Date().toISOString()]);
      }
    } else if (daysUntilDue === 1) {
      var key1 = todayStr + "_" + loan.loan_id + "_DUE_IN_1";
      if (!sentTodaySet[key1]) {
        dueIn1DayList.push(loan);
        logsToAppend.push(["log_" + new Date().getTime() + "_" + i, todayStr, loan.loan_id, "DUE_IN_1", new Date().toISOString()]);
      }
    } else if (daysUntilDue === 3) {
      var key3 = todayStr + "_" + loan.loan_id + "_DUE_IN_3";
      if (!sentTodaySet[key3]) {
        dueIn3DaysList.push(loan);
        logsToAppend.push(["log_" + new Date().getTime() + "_" + i, todayStr, loan.loan_id, "DUE_IN_3", new Date().toISOString()]);
      }
    } else if (daysUntilDue < 0) {
      var keyOver = todayStr + "_" + loan.loan_id + "_OVERDUE";
      if (!sentTodaySet[keyOver]) {
        overdueList.push(loan);
        logsToAppend.push(["log_" + new Date().getTime() + "_" + i, todayStr, loan.loan_id, "OVERDUE", new Date().toISOString()]);
      }
    }
  }

  // ---- Process Borrowing reminders (money borrowed IN, you need to return) ----
  var bDueTodayList = [];
  var bDueIn1DayList = [];
  var bDueIn3DaysList = [];
  var bOverdueList = [];

  for (var bi = 0; bi < borrowings.length; bi++) {
    var borrowing = borrowings[bi];
    if (borrowing.status === "Completed" || !borrowing.expected_return_date) continue;

    var bDaysUntilDue = borrowing.days_until_due;
    var bId = borrowing.borrowing_id;

    if (bDaysUntilDue === 0) {
      var bKey0 = todayStr + "_" + bId + "_BORROW_DUE_TODAY";
      if (!sentTodaySet[bKey0]) {
        bDueTodayList.push(borrowing);
        logsToAppend.push(["log_" + new Date().getTime() + "_b" + bi, todayStr, bId, "BORROW_DUE_TODAY", new Date().toISOString()]);
      }
    } else if (bDaysUntilDue === 1) {
      var bKey1 = todayStr + "_" + bId + "_BORROW_DUE_IN_1";
      if (!sentTodaySet[bKey1]) {
        bDueIn1DayList.push(borrowing);
        logsToAppend.push(["log_" + new Date().getTime() + "_b" + bi, todayStr, bId, "BORROW_DUE_IN_1", new Date().toISOString()]);
      }
    } else if (bDaysUntilDue === 3) {
      var bKey3 = todayStr + "_" + bId + "_BORROW_DUE_IN_3";
      if (!sentTodaySet[bKey3]) {
        bDueIn3DaysList.push(borrowing);
        logsToAppend.push(["log_" + new Date().getTime() + "_b" + bi, todayStr, bId, "BORROW_DUE_IN_3", new Date().toISOString()]);
      }
    } else if (bDaysUntilDue < 0) {
      var bKeyOver = todayStr + "_" + bId + "_BORROW_OVERDUE";
      if (!sentTodaySet[bKeyOver]) {
        bOverdueList.push(borrowing);
        logsToAppend.push(["log_" + new Date().getTime() + "_b" + bi, todayStr, bId, "BORROW_OVERDUE", new Date().toISOString()]);
      }
    }
  }

  var totalAlerts = dueTodayList.length + dueIn1DayList.length + dueIn3DaysList.length + overdueList.length
    + bDueTodayList.length + bDueIn1DayList.length + bDueIn3DaysList.length + bOverdueList.length;
  if (totalAlerts === 0) return;

  function formatInr(val) {
    return "₹" + Number(val).toLocaleString('en-IN');
  }

  var htmlBody = "<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;'>";
  htmlBody += "<div style='background: #2563eb; color: #ffffff; padding: 18px 24px; border-radius: 8px 8px 0 0;'>";
  htmlBody += "<h2 style='margin: 0; font-size: 20px;'>🔔 Lend Tracker - Daily Reminder Digest</h2>";
  htmlBody += "<p style='margin: 4px 0 0; font-size: 13px; opacity: 0.9;'>Date: " + todayStr + " (IST)</p>";
  htmlBody += "</div><div style='background: #ffffff; padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;'>";

  function renderLoanSection(title, list, badgeColor, badgeText) {
    if (list.length === 0) return "";
    var s = "<h3 style='margin: 18px 0 10px; font-size: 16px; border-bottom: 2px solid #f1f5f9; padding-bottom: 6px;'>" + title + " (" + list.length + ")</h3>";
    for (var j = 0; j < list.length; j++) {
      var item = list[j];
      s += "<div style='background: #f8fafc; border-left: 4px solid " + badgeColor + "; padding: 12px 16px; margin-bottom: 10px; border-radius: 4px;'>";
      s += "<div style='display: flex; justify-content: space-between;'><strong>" + item.borrower_name + "</strong><span style='color: " + badgeColor + "; font-weight: bold;'>" + badgeText + "</span></div>";
      s += "<div style='font-size: 13px; color: #475569; margin-top: 6px;'>";
      s += "<div><strong>Remaining Balance:</strong> " + formatInr(item.remaining_balance);
      if (item.accrued_interest > 0) {
        s += " (Includes " + formatInr(item.accrued_interest) + " accrued interest)";
      }
      s += "</div><div><strong>Due Date:</strong> " + item.expected_return_date + "</div>";
      if (item.phone_or_email) s += "<div><strong>Contact:</strong> " + item.phone_or_email + "</div>";
      if (item.notes) s += "<div><strong>Note:</strong> " + item.notes + "</div>";
      s += "</div></div>";
    }
    return s;
  }

  function renderBorrowingSection(title, list, badgeColor, badgeText) {
    if (list.length === 0) return "";
    var s = "<h3 style='margin: 18px 0 10px; font-size: 16px; border-bottom: 2px solid #f1f5f9; padding-bottom: 6px;'>" + title + " (" + list.length + ")</h3>";
    for (var j = 0; j < list.length; j++) {
      var item = list[j];
      s += "<div style='background: #fefce8; border-left: 4px solid " + badgeColor + "; padding: 12px 16px; margin-bottom: 10px; border-radius: 4px;'>";
      s += "<div style='display: flex; justify-content: space-between;'><strong>" + item.lender_name + "</strong><span style='color: " + badgeColor + "; font-weight: bold;'>" + badgeText + "</span></div>";
      s += "<div style='font-size: 13px; color: #475569; margin-top: 6px;'>";
      s += "<div><strong>Amount to Return:</strong> " + formatInr(item.remaining_balance);
      if (item.accrued_interest > 0) {
        s += " (Includes " + formatInr(item.accrued_interest) + " accrued interest)";
      }
      s += "</div><div><strong>Due Date:</strong> " + item.expected_return_date + "</div>";
      if (item.phone_or_email) s += "<div><strong>Contact:</strong> " + item.phone_or_email + "</div>";
      if (item.notes) s += "<div><strong>Note:</strong> " + item.notes + "</div>";
      s += "</div></div>";
    }
    return s;
  }

  // Loans section (money lent out)
  if (overdueList.length + dueTodayList.length + dueIn1DayList.length + dueIn3DaysList.length > 0) {
    htmlBody += "<h2 style='font-size: 18px; color: #1d4ed8; margin-top: 0;'>💰 Loans — Money Lent Out</h2>";
    htmlBody += renderLoanSection("⚠️ Overdue Loans", overdueList, "#dc2626", "OVERDUE");
    htmlBody += renderLoanSection("📅 Due Today", dueTodayList, "#ea580c", "DUE TODAY");
    htmlBody += renderLoanSection("⏳ Due Tomorrow (in 1 day)", dueIn1DayList, "#ca8a04", "1 DAY LEFT");
    htmlBody += renderLoanSection("🔔 Due in 3 Days", dueIn3DaysList, "#2563eb", "3 DAYS LEFT");
  }

  // Borrowings section (money you need to return)
  if (bOverdueList.length + bDueTodayList.length + bDueIn1DayList.length + bDueIn3DaysList.length > 0) {
    htmlBody += "<h2 style='font-size: 18px; color: #92400e; margin-top: 20px;'>🏦 Borrowings — Money You Need to Return</h2>";
    htmlBody += renderBorrowingSection("⚠️ Overdue Borrowings", bOverdueList, "#dc2626", "OVERDUE");
    htmlBody += renderBorrowingSection("📅 Due Today", bDueTodayList, "#ea580c", "DUE TODAY");
    htmlBody += renderBorrowingSection("⏳ Due Tomorrow (in 1 day)", bDueIn1DayList, "#ca8a04", "1 DAY LEFT");
    htmlBody += renderBorrowingSection("🔔 Due in 3 Days", bDueIn3DaysList, "#2563eb", "3 DAYS LEFT");
  }

  htmlBody += "</div></div>";

  var recipient = getNotificationEmail();
  MailApp.sendEmail({
    to: recipient,
    subject: "🔔 Lend Tracker: " + totalAlerts + " repayment(s) need attention",
    htmlBody: htmlBody
  });

  for (var m = 0; m < logsToAppend.length; m++) {
    logSheet.appendRow(logsToAppend[m]);
  }
}

/**
 * ==============================================================================
 * AUTOMATED WEEKLY BACKUP
 * ==============================================================================
 */
function backupSheetWeekly() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var originalFile = DriveApp.getFileById(ss.getId());

  var folderName = "LendTracker_Backups";
  var folders = DriveApp.getFoldersByName(folderName);
  var backupFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

  var dateStamp = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd_HHmm");
  originalFile.makeCopy("LendTracker_Backup_" + dateStamp, backupFolder);
}
