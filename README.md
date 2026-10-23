# 💸 Lend Tracker

A secure, mobile-friendly personal Progressive Web App (PWA) to track money lent to friends and family, record partial/full repayments, calculate interest, attach receipts, and get automated daily return-date email reminders.

## ✨ Core Features
- **100% Free & Serverless**: Built using pure HTML/CSS/JS (hosted on GitHub Pages) and Google Sheets with Google Apps Script. Zero monthly fees.
- **Secure by Design**: Zero secrets committed to GitHub. Authorization enforced on Google Apps Script via a private passcode.
- **PWA Ready**: Installable on Android, iPhone (iOS Safari), and Desktop ("Add to Home Screen").
- **Financial Statuses**: Automatically calculated statuses (`Pending`, `Partial`, `Completed`, `Overdue`).
- **Payment History & Timeline**: Full audit trail of every repayment with real-time balance checks.
- **Due Date Reminders**: Automated daily morning email reminder digest (due today, due tomorrow, due in 3 days, overdue) with zero duplicate emails.
- **Instant WhatsApp Link**: One-click prefilled WhatsApp reminder generator (`wa.me`).
- **Indian Rupee & Timezone**: Formatted as ₹ Lakhs/Crores (`en-IN`) and `DD/MM/YYYY` in `Asia/Kolkata`.
- **Data Export & Automated Backups**: One-click CSV export and automated weekly Google Drive backups.

## 🚀 Advanced Features
1. **Accrued Interest Calculation**:
   - Supports **Simple Interest (% per year)**, **Simple Interest (% per month)**, or a **Fixed Fee (₹)**.
   - Automatically computes accrued interest based on elapsed days.
   - Balance and payment checks automatically include interest.
2. **Receipt & Document Upload**:
   - Attach photos of promissory notes, loan agreements, or checks.
   - Attach UPI payment screenshots or receipt slips with each repayment.
   - Files are automatically saved to a dedicated `LendTracker_Attachments` folder in Google Drive with instant view links.
3. **Borrower Statement Portal**:
   - Each loan generates a secure, unguessable portal token.
   - Share a live, read-only loan statement with the borrower via WhatsApp.
   - Includes full payment history, remaining balance, and a **1-click UPI Repay button** (`upi://pay`) directly to your UPI ID!
