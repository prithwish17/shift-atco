import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { Moon, Sun, Eye, EyeOff, UserPlus, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { registerSchema, RegisterInput } from "@/lib/validations";

const LICENSE_OPTIONS = [
  { value: "rdr", label: "RDR - Radar" },
  { value: "app", label: "APP - Approach" },
  { value: "plr", label: "PLR - Planner" },
  { value: "adc", label: "ADC - Aerodrome" },
  { value: "alpha", label: "ALPHA" },
  { value: "occ", label: "OCC - Oceanic" },
];

export default function Register() {
  const { theme, toggleTheme } = useTheme();
  const { signUp } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [selectedLicenses, setSelectedLicenses] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof RegisterInput, string>>>({});
  const [authError, setAuthError] = useState<string>("");

  const [formData, setFormData] = useState({
    full_name: "",
    employee_id: "",
    email: "",
    mobile: "",
    designation: "",
    current_shift: "" as "general" | "a" | "b" | "c" | "d" | "e" | "",
    password: "",
    confirmPassword: "",
    termsAccepted: false,
  });

  const toggleLicense = (license: string) => {
    setSelectedLicenses(prev =>
      prev.includes(license)
        ? prev.filter(l => l !== license)
        : [...prev, license]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrors({});
    setAuthError("");

    try {
      const validated = registerSchema.parse({
        ...formData,
        licenses: selectedLicenses,
      });

      const { error } = await signUp(validated.email, validated.password, {
        full_name: validated.full_name,
        employee_id: validated.employee_id,
        mobile: validated.mobile,
        designation: validated.designation,
        current_shift: validated.current_shift,
        licenses: selectedLicenses,
      });

      if (error) {
        // Use generic error messages to prevent account enumeration
        setAuthError("Registration failed. Please verify your information and try again.");
        // Log detailed error for debugging (server-side in production)
        if (import.meta.env.DEV) console.error("Registration error:", error);
      } else {
        toast({
          title: "Registration Successful",
          description: "Your account has been created. Please check your email to confirm.",
        });
        setTimeout(() => navigate("/login"), 2000);
      }
    } catch (error: any) {
      if (error.errors) {
        const fieldErrors: Partial<Record<keyof RegisterInput, string>> = {};
        error.errors.forEach((err: any) => {
          if (err.path[0]) {
            fieldErrors[err.path[0] as keyof RegisterInput] = err.message;
          }
        });
        setErrors(fieldErrors);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <Button variant="ghost" size="icon" onClick={toggleTheme}>
          {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </Button>
      </div>

      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center mb-4">
            <UserPlus className="h-10 w-10 text-primary" />
          </div>
          <CardTitle className="text-3xl">User Registration</CardTitle>
          <CardDescription>Create your ATCORA account</CardDescription>
        </CardHeader>
        <CardContent>
          {authError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="full_name">Full Name *</Label>
                <Input
                  id="full_name"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  disabled={isLoading}
                />
                {errors.full_name && <p className="text-sm text-destructive">{errors.full_name}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="employee_id">Employee ID *</Label>
                <Input
                  id="employee_id"
                  placeholder="10024....."
                  value={formData.employee_id}
                  onChange={(e) => setFormData({ ...formData, employee_id: e.target.value.toUpperCase() })}
                  className="font-mono"
                  disabled={isLoading}
                />
                {errors.employee_id && <p className="text-sm text-destructive">{errors.employee_id}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={isLoading}
                />
                {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="mobile">Mobile</Label>
                <Input
                  id="mobile"
                  type="tel"
                  placeholder="9876....."
                  value={formData.mobile}
                  onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                  disabled={isLoading}
                />
                {errors.mobile && <p className="text-sm text-destructive">{errors.mobile}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="designation">Designation *</Label>
                <Input
                  id="designation"
                  placeholder="JE / MGR......"
                  value={formData.designation}
                  onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                  disabled={isLoading}
                />
                {errors.designation && <p className="text-sm text-destructive">{errors.designation}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="current_shift">Current Shift *</Label>
                <Select
                  value={formData.current_shift}
                  onValueChange={(value: any) => setFormData({ ...formData, current_shift: value })}
                  disabled={isLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select shift" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="a">Shift A</SelectItem>
                    <SelectItem value="b">Shift B</SelectItem>
                    <SelectItem value="c">Shift C</SelectItem>
                    <SelectItem value="d">Shift D</SelectItem>
                    <SelectItem value="e">Shift E</SelectItem>
                  </SelectContent>
                </Select>
                {errors.current_shift && <p className="text-sm text-destructive">{errors.current_shift}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Licenses</Label>
              <div className="flex flex-wrap gap-2">
                {LICENSE_OPTIONS.map((license) => (
                  <Badge
                    key={license.value}
                    variant={selectedLicenses.includes(license.value) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => !isLoading && toggleLicense(license.value)}
                  >
                    {license.label}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    disabled={isLoading}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password *</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    disabled={isLoading}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword}</p>}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="terms"
                checked={formData.termsAccepted}
                onCheckedChange={(checked) => setFormData({ ...formData, termsAccepted: checked as boolean })}
                disabled={isLoading}
              />
              <Label htmlFor="terms" className="text-sm cursor-pointer">
                I accept the terms and conditions
              </Label>
            </div>
            {errors.termsAccepted && <p className="text-sm text-destructive">{errors.termsAccepted}</p>}


            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Registering..." : "Register"}
            </Button>

            <div className="text-center text-sm">
              <Link to="/login" className="text-primary hover:underline">
                Back to Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
