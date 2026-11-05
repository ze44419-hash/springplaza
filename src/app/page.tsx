import { redirect } from 'next/navigation';
// Middleware redirects signed-in users to their home; this is the fallback.
export default function Index() { redirect('/login'); }
