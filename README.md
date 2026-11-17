# Student Business Game

A classroom economy web app. Students get a personal bank account with a 4-digit PIN and a money dashboard. They can apply for a Business Permit, invite partners with a code, sell items through a cash register (customers pay with their PIN), pay the owners, and apply for grants and loans. The teacher back end handles approvals, awards, taxes and fees, refunds and loan interest.

- **Students:** `https://YOUR-SITE.pages.dev/`
- **Teacher:** `https://YOUR-SITE.pages.dev/teacher.html`

---

## Setup (GitHub + Cloudflare Pages + D1)

### 1. Put the code on GitHub
1. Create a new repository on GitHub (for example `student-business-game`).
2. Click **Add file → Upload files**, then drag in everything from this folder: `public`, `functions`, `schema.sql`, `README.md`.
   *Keep the folder structure. The file `functions/api/[[path]].js` must stay in that folder with that exact name, brackets included.*
3. Click **Commit changes**.

### 2. Create the database
1. In the Cloudflare dashboard, go to **Storage & Databases → D1 SQL Database → Create**.
2. Name it `business_game` and create it.
3. *(Optional)* The site creates its tables automatically the first time it runs. To create them yourself, open the database's **Console**, paste in all of `schema.sql`, and click **Execute**.

### 3. Create the Pages site
1. Go to **Workers & Pages → Create → Pages → Connect to Git** and pick your repository.
2. Use these build settings:
   - **Framework preset:** None
   - **Build command:** *(leave blank)*
   - **Build output directory:** `public`
3. Click **Save and Deploy**.

### 4. Connect the database and set your teacher password
In your Pages project, open **Settings**:
1. Under **Bindings**, click **Add → D1 database**.
   - **Variable name:** `DB` *(capital letters, exactly)*
   - **D1 database:** `business_game`
2. Under **Variables and Secrets**, click **Add**.
   - **Type:** Secret
   - **Variable name:** `TEACHER_PASSWORD`
   - **Value:** your password
3. Go to **Deployments** and click **Retry deployment** on the latest deployment, so the new settings take effect.

### 5. First-time setup in the app
1. Open `/teacher.html` and log in with your teacher password.
2. Go to **Settings**. Set the **class code** students will use to sign up, the **starting balance** for new accounts, and the bank's name.
3. Students go to the main page, choose **New account**, and enter the class code. You can also add students in bulk under **Students → Add students from a roster**, one per line: `Name, username, password, period`.

---

## How the game works

### Students
- **My Bank:** balance card, money in and out, a balance-over-time chart, a "where my money went" chart, daily in/out bars, income sources, and recent activity.
- **Bank PIN:** every student creates a 4-digit PIN, which they need before they can buy anything. Changing it requires their account password. After 5 wrong tries at a register, the PIN locks for 10 minutes. You can unlock or reset it from **Students → Manage**.
- **Create a Business:** fills out the Business Permit form (name, slogan, description, logo upload, items with descriptions and prices). The student gets a **partner code** to share.
- **Join a Business:** a student enters a partner code to join.
- **Business tile:** each business shows as a tile on the student's profile and links to the business page. Until the permit is approved, the tile shows "Pending" and the cash register stays locked.
- **Business page tabs:**
  - **Cash Register:** tap items to build the sale, pick the customer from the class dropdown, and have the customer type their PIN. Their bank account is charged and the sale is logged for the business.
  - **Dashboard:** revenue, expenses, profit, owner payouts, a balance chart, sales by day, **top-selling items**, an expense breakdown, and every business transaction.
  - **Items for Sale:** add, edit or remove items.
  - **Payouts & Expenses:** pay owners from the business account (there is a "split evenly" button), pay business expenses, and make loan payments.
  - **Business Info:** edit the name, slogan, description and logo, see the partner list and the partner code.
- **Grants:** an application asking how the business will improve society, who it helps, the spending plan and the amount. Grants are not paid back.
- **Loans:** an application asking for the business description, goals, how much money they plan to make, a repayment plan and the amount. Students pay loans back from their own account or the business account.
- **Class Market:** a list of every open business and what it sells.

### Teacher (`/teacher.html`)
- **Overview:** class totals, items waiting for review, top businesses and the highest student balances.
- **Permits:** approve or reject Business Permits with a note to students, close a business, remove a partner, and see a business's transactions.
- **Grants:** read each application and approve it for any amount, or deny it. The money goes into the business account if the business is approved, and otherwise into the student's account.
- **Loans:** set the loan amount and **interest rate** (the page previews the total owed) when approving. For active loans you can add another round of interest, set the amount owed, or forgive the loan.
- **Award / Charge:** award money, or charge **taxes or fees** as a flat amount or a percent of the balance. Each can go to all students, all businesses, a whole class period, or individual students and businesses.
- **Students:** add students from a roster. **Manage** lets you give a quick award, fee or tax, edit a name or period, set a password, reset or unlock a PIN, view the student's history, or turn the account off.
- **Transactions:** the full ledger, which you can filter by student or business. **Refund** reverses any transaction:
  - A refunded sale returns the customer's money and drops out of the top sellers.
  - A refunded loan payment is added back to what is owed.
- **Settings:** the class code, starting balance, whether students can sign up themselves, and the bank name.

### Rules built in
- A purchase is declined if the customer doesn't have enough money.
- Payouts and expenses can't be more than the business has.
- Taxes and fees can push a balance below $0, so students can go into debt.
- Money is stored in cents, so there are no rounding errors.

## Updating the site
Edit or upload files in GitHub and Cloudflare redeploys automatically within a minute. Your data stays in the D1 database.
