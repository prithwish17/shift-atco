import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { Moon, Sun, Calendar, Users, ClipboardList, Shield } from "lucide-react";

const Index = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, userRole, loading } = useAuth();
  const navigate = useNavigate();

  // Redirect logged-in users to their dashboard
  useEffect(() => {
    if (!loading && user && userRole) {
      navigate('/employee');
    }
  }, [user, userRole, loading, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <h1 className="text-2xl font-bold text-primary">ShiftPlan</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="rounded-full"
            >
              {theme === "light" ? (
                <Moon className="h-5 w-5" />
              ) : (
                <Sun className="h-5 w-5" />
              )}
            </Button>
            <Link to="/login">
              <Button>Login</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="text-center space-y-4 mb-12">
          <h2 className="text-4xl font-bold tracking-tight">
            Comprehensive Shift Management System
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            ShiftPlan helps organizations manage complex rotating shift schedules,
            attendance tracking, leave management, and compliance monitoring.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <Card>
            <CardHeader>
              <Calendar className="h-8 w-8 text-primary mb-2" />
              <CardTitle>Shift Management</CardTitle>
              <CardDescription>
                Manage rotating shifts with automatic rotation calculations
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Users className="h-8 w-8 text-accent mb-2" />
              <CardTitle>Team Coordination</CardTitle>
              <CardDescription>
                Track attendance and manage duty exchanges seamlessly
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <ClipboardList className="h-8 w-8 text-warning mb-2" />
              <CardTitle>Leave Management</CardTitle>
              <CardDescription>
                Multi-tier approval workflows for various leave types
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Shield className="h-8 w-8 text-secondary mb-2" />
              <CardTitle>Compliance</CardTitle>
              <CardDescription>
                Automated testing schedules and detailed audit trails
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Get Started</CardTitle>
            <CardDescription>
              Phase 1 Implementation - Core UI & Authentication Pages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This is the foundational setup for ShiftPlan. The authentication system,
              dashboard interfaces, and backend integration will be implemented in subsequent phases.
            </p>
            <div className="flex justify-center">
              <Link to="/login">
                <Button size="lg">
                  Go to Login
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>

      <footer className="border-t mt-12">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          ShiftPlan v1.0.0 - Phase 1 Implementation
        </div>
      </footer>
    </div>
  );
};

export default Index;
