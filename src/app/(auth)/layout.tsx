import React from "react";

/**
 * Route-group layout for authentication routes:
 * /login, /signup, /forgot-password, /reset-password
 * 
 * Provides a clean, full-screen canvas without the main navbar and footer.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full flex flex-col bg-white">
      {children}
    </div>
  );
}
