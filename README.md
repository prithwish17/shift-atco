# ShiftBud

Employee shift management and HR dashboard application.

## Tech Stack

- Vite
- TypeScript
- React
- shadcn/ui
- Tailwind CSS
- Supabase

## Getting Started

```sh
# Clone the repository
git clone <YOUR_GIT_URL>

# Navigate to the project directory
cd <YOUR_PROJECT_NAME>

# Install dependencies
npm i

# Start the development server
npm run dev
```

## Deployment

Build the production bundle:

```sh
npm run build
```

For auth emails such as password reset and signup confirmation, set `VITE_APP_BASE_URL` to your deployed app URL so links always return to the correct domain.

For the supervisor suggestion page inside Shift ATCO, set `VITE_ROSTER_AUTOMATION_API_URL` to the separate roster automation controller API. Local development uses `http://localhost:4000` by default when the app itself is running on localhost.

Example:

```sh
VITE_APP_BASE_URL=https://atcora.in
VITE_ROSTER_AUTOMATION_API_URL=http://localhost:4000
```
