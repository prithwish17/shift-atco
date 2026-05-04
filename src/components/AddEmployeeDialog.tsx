import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { UserPlus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { invokeImportEmployees } from "@/lib/importEmployees";
import { logSupervisorEdit } from "@/lib/supervisorAuditLog";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const SHIFTS = [
    { value: "general", label: "General" },
    { value: "a", label: "Shift A" },
    { value: "b", label: "Shift B" },
    { value: "c", label: "Shift C" },
    { value: "d", label: "Shift D" },
    { value: "e", label: "Shift E" },
];

const GENDERS = [
    { value: "Male", label: "Male" },
    { value: "Female", label: "Female" },
    { value: "Other", label: "Other" },
];

export function AddEmployeeDialog({ open, onOpenChange }: Props) {
    const queryClient = useQueryClient();
    const [submitting, setSubmitting] = useState(false);

    // Form state
    const [form, setForm] = useState({
        employee_id: "",
        full_name: "",
        email: "",
        mobile: "",
        initials: "",
        designation: "",
        stream: "",
        gender: "",
        alternate_email: "",
        current_shift: "general",
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const updateField = (field: string, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        // Clear error when user types
        if (errors[field]) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next[field];
                return next;
            });
        }
    };

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!form.employee_id.trim()) newErrors.employee_id = "Emp. ID is required";
        if (!form.full_name.trim()) newErrors.full_name = "Employee Name is required";
        if (!form.email.trim()) newErrors.email = "Email is required";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
            newErrors.email = "Invalid email format";
        if (!form.mobile.trim()) newErrors.mobile = "Contact No. is required";

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async () => {
        if (!validate()) return;

        setSubmitting(true);

        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (!session) {
                toast.error("You must be logged in");
                setSubmitting(false);
                return;
            }

            const payload = {
                employee_id: form.employee_id.trim(),
                full_name: form.full_name.trim(),
                email: form.email.trim().toLowerCase(),
                mobile: form.mobile.trim() || undefined,
                initials: form.initials.trim() || undefined,
                designation: form.designation.trim() || undefined,
                stream: form.stream.trim() || undefined,
                gender: form.gender || undefined,
                alternate_email: form.alternate_email.trim() || undefined,
                current_shift: form.current_shift || "general",
            };

            const res = await invokeImportEmployees({ employees: [payload] });

            if (res.created.length > 0) {
                toast.success(
                    `Employee ${form.full_name} registered successfully! Login: ${form.email} / ShiftPlan@${form.employee_id}`
                );
                logSupervisorEdit({
                    action: "insert",
                    table: "profiles",
                    description: `New employee added: ${form.full_name.trim()} (${form.employee_id.trim()})`,
                    recordId: form.employee_id.trim(),
                    after: {
                        employee_id: form.employee_id.trim(),
                        full_name: form.full_name.trim(),
                        email: form.email.trim().toLowerCase(),
                        designation: form.designation.trim() || null,
                        current_shift: form.current_shift || "general",
                    },
                });
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["users"] }),
                    queryClient.invalidateQueries({ queryKey: ["all-licenses"] }),
                    queryClient.invalidateQueries({ queryKey: ["training-data"] }),
                    queryClient.invalidateQueries({ queryKey: ["rating-sync-data"] }),
                    queryClient.invalidateQueries({ queryKey: ["elpa-data"] }),
                    queryClient.invalidateQueries({ queryKey: ["medical-sync-data"] }),
                    queryClient.invalidateQueries({ queryKey: ["trainee-sync-data"] }),
                ]);
                resetAndClose();
            } else if (res.skipped.length > 0) {
                toast.warning(`Skipped: ${res.skipped[0].reason}`);
            } else if (res.failed.length > 0) {
                toast.error(`Failed: ${res.failed[0].error}`);
            }
        } catch (err: any) {
            toast.error(err.message || "Something went wrong");
        }

        setSubmitting(false);
    };

    const resetForm = () => {
        setForm({
            employee_id: "",
            full_name: "",
            email: "",
            mobile: "",
            initials: "",
            designation: "",
            stream: "",
            gender: "",
            alternate_email: "",
            current_shift: "general",
        });
        setErrors({});
    };

    const resetAndClose = () => {
        resetForm();
        onOpenChange(false);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!v) resetForm();
                onOpenChange(v);
            }}
        >
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserPlus className="h-5 w-5" />
                        Add New Employee
                    </DialogTitle>
                    <DialogDescription>
                        Fill in the employee details. Login credentials will be:{" "}
                        <strong>Email</strong> as login ID and{" "}
                        <strong>ShiftPlan@&#123;Emp. ID&#125;</strong> as password.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {/* Row 1: Emp ID + Initials */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="employee_id">
                                Emp. ID <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="employee_id"
                                placeholder="10024....."
                                value={form.employee_id}
                                onChange={(e) => updateField("employee_id", e.target.value)}
                                className={errors.employee_id ? "border-destructive" : ""}
                            />
                            {errors.employee_id && (
                                <p className="text-xs text-destructive">{errors.employee_id}</p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="initials">Initials</Label>
                            <Input
                                id="initials"
                                placeholder="Mr. / Mrs"
                                value={form.initials}
                                onChange={(e) => updateField("initials", e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Row 2: Name */}
                    <div className="space-y-2">
                        <Label htmlFor="full_name">
                            Employee Name <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            id="full_name"
                            placeholder="Full name"
                            value={form.full_name}
                            onChange={(e) => updateField("full_name", e.target.value)}
                            className={errors.full_name ? "border-destructive" : ""}
                        />
                        {errors.full_name && (
                            <p className="text-xs text-destructive">{errors.full_name}</p>
                        )}
                    </div>

                    {/* Row 3: Email + Contact */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">
                                Email ID <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="name@example.com"
                                value={form.email}
                                onChange={(e) => updateField("email", e.target.value)}
                                className={errors.email ? "border-destructive" : ""}
                            />
                            {errors.email && (
                                <p className="text-xs text-destructive">{errors.email}</p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="mobile">
                                Contact No. <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="mobile"
                                placeholder="9876....."
                                value={form.mobile}
                                onChange={(e) => updateField("mobile", e.target.value)}
                                className={errors.mobile ? "border-destructive" : ""}
                            />
                            {errors.mobile && (
                                <p className="text-xs text-destructive">{errors.mobile}</p>
                            )}
                        </div>
                    </div>

                    {/* Row 4: Designation + Stream */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="designation">Designation</Label>
                            <Input
                                id="designation"
                                placeholder="JE / MGR......"
                                value={form.designation}
                                onChange={(e) => updateField("designation", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="stream">Stream Alloted</Label>
                            <Input
                                id="stream"
                                placeholder="CSTRM / ENROUTE"
                                value={form.stream}
                                onChange={(e) => updateField("stream", e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Row 5: Gender + Shift */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Gender</Label>
                            <Select
                                value={form.gender}
                                onValueChange={(v) => updateField("gender", v)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select gender" />
                                </SelectTrigger>
                                <SelectContent>
                                    {GENDERS.map((g) => (
                                        <SelectItem key={g.value} value={g.value}>
                                            {g.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Shift Name</Label>
                            <Select
                                value={form.current_shift}
                                onValueChange={(v) => updateField("current_shift", v)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select shift" />
                                </SelectTrigger>
                                <SelectContent>
                                    {SHIFTS.map((s) => (
                                        <SelectItem key={s.value} value={s.value}>
                                            {s.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Row 6: Alternate Email */}
                    <div className="space-y-2">
                        <Label htmlFor="alternate_email">Alternate Mail Address</Label>
                        <Input
                            id="alternate_email"
                            type="email"
                            placeholder="alt.email@example.com"
                            value={form.alternate_email}
                            onChange={(e) => updateField("alternate_email", e.target.value)}
                        />
                    </div>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={resetAndClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={submitting}>
                        {submitting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Registering...
                            </>
                        ) : (
                            <>
                                <UserPlus className="h-4 w-4 mr-2" />
                                Add & Register Employee
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
