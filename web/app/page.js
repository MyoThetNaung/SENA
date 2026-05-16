import { redirect } from 'next/navigation';

/** Admin control panel (legacy UI) lives at /admin.html */
export default function HomePage() {
  redirect('/admin.html');
}
