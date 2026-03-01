import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Invalid email address")
    .max(255, "Email must be less than 255 characters"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must be less than 100 characters"),
});

export const registerSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, "Full name is required")
    .max(100, "Name must be less than 100 characters"),
  employee_id: z
    .string()
    .trim()
    .min(1, "Employee ID is required")
    .max(50, "Employee ID must be less than 50 characters")
    .regex(/^[A-Z0-9]+$/, "Employee ID must contain only uppercase letters and numbers"),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Invalid email address")
    .max(255, "Email must be less than 255 characters"),
  mobile: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, "Mobile number must be 10 digits")
    .optional()
    .or(z.literal("")),
  designation: z
    .string()
    .trim()
    .min(1, "Designation is required")
    .max(100, "Designation must be less than 100 characters"),
  current_shift: z.enum(["general", "a", "b", "c", "d", "e"], {
    required_error: "Shift is required",
  }),
  licenses: z.array(z.string()).optional(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must be less than 100 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
  confirmPassword: z.string(),
  termsAccepted: z.boolean().refine((val) => val === true, {
    message: "You must accept the terms and conditions",
  }),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export const passwordResetSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Invalid email address")
    .max(255, "Email must be less than 255 characters"),
});

export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must be less than 100 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
