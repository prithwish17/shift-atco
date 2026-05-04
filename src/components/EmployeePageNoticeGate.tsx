import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEmployeePageNoticeSettings } from "@/hooks/useEmployeePageNoticeSettings";
import { findEmployeePageNoticeRoute } from "@/lib/employeePageNotices";

export function EmployeePageNoticeGate() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: noticeSettings } = useEmployeePageNoticeSettings();
  const [open, setOpen] = useState(false);

  const matchedRoute = useMemo(
    () => findEmployeePageNoticeRoute(location.pathname),
    [location.pathname],
  );

  const noticeEnabled = matchedRoute ? noticeSettings?.[matchedRoute.key] === true : false;

  useEffect(() => {
    if (!matchedRoute || !noticeEnabled) {
      setOpen(false);
      return;
    }

    setOpen(true);
  }, [location.key, location.pathname, matchedRoute, noticeEnabled]);

  const handleExploreAnyway = () => {
    setOpen(false);
  };

  const handleProvideFeedback = () => {
    setOpen(false);
    navigate("/settings?portal=employee#contact");
  };

  if (!matchedRoute || !noticeEnabled) {
    return null;
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{matchedRoute.title} is not active yet</AlertDialogTitle>
          <AlertDialogDescription>
            This function has not started for employee use yet. You may explore the page, or
            provide feedback for review.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleExploreAnyway}>Explore anyway</AlertDialogCancel>
          <AlertDialogAction onClick={handleProvideFeedback}>Provide feedback</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
