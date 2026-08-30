import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"English Department Assessment Planner",description:"Assessment planning and follow-up for Al Reyadah School English Department, Grades 5–12.",icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
