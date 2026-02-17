import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun, Bell, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Role = "admin" | "supervisor" | "wso" | "employee";

interface DashboardLayoutProps {
  role: Role;
  children: ReactNode;
}

export function DashboardLayout({ role, children }: DashboardLayoutProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar role={role} />
        
        <div className="flex-1 flex flex-col">
          <header className="h-14 border-b bg-card flex items-center px-4 justify-between sticky top-0 z-10">
            <SidebarTrigger className="mr-2" />
            
            <div className="flex items-center gap-2">
              {(role === "wso" || role === "supervisor") && (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/employee">
                    <ArrowLeftRight className="mr-2 h-4 w-4" />
                    Employee Dashboard
                  </Link>
                </Button>
              )}

              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs">
                  3
                </Badge>
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
              >
                {theme === "light" ? (
                  <Moon className="h-5 w-5" />
                ) : (
                  <Sun className="h-5 w-5" />
                )}
              </Button>
            </div>
          </header>

          <main className="flex-1 p-6 bg-background">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
