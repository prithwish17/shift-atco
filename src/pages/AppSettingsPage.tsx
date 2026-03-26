import { Link, useSearchParams } from "react-router-dom";
import {
  BellRing,
  Bug,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  Info,
  Mail,
  MessageCircleMore,
  MessagesSquare,
  Settings,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { NotificationSettings } from "@/components/NotificationSettings";
import { SettingsPasswordForm } from "@/components/SettingsPasswordForm";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { usePWAOnboarding } from "@/contexts/PWAOnboardingContext";

type Role = "admin" | "supervisor" | "wso" | "employee";

const appHighlights = [
  "Duty schedules and shift duty roster access for Kolkata ATCOs",
  "Attendance visibility and comp-off tracking",
  "Leave application, review flow, and leave status updates",
  "Duty exchange workflow between controllers and approvers",
  "License, rating, medical, ELPA, and endorsement visibility",
  "Holiday reference, OPE reminders, and roster-related alerts",
];

const notificationHighlights = [
  "In-app notifications appear inside the bell menu while you are using the webapp.",
  "Push notifications are intended for immediate alerts such as leave outcomes, duty updates, OPE reminders, and critical expiry alerts.",
  "Email delivery is queued in the background for users who prefer email updates or may miss real-time alerts.",
  "Notification settings let you choose event-by-event whether you want email, push, or in-app delivery.",
];

const appMeta = {
  version: "Phase 8 build",
  lastUpdated: "26 Mar 2026",
};

const faqs = [
  {
    value: "who-is-this-for",
    question: "Who is this app for?",
    answer:
      "This webapp is built specifically for ATCOs in Kolkata. The language, workflows, dashboards, and reminders are shaped around roster handling, leave operations, attendance, OPE duties, and licensing needs that matter to that group.",
  },
  {
    value: "what-can-i-do",
    question: "What can I do in the app?",
    answer:
      "Depending on your role, you can check schedules, review attendance, apply for leave, manage duty exchanges, view holidays, track comp-off balances, monitor license and medical validity, and maintain profile information. Supervisors and WSOs also get review and management tools.",
  },
  {
    value: "how-do-notifications-work",
    question: "How do notifications and emails work?",
    answer:
      "The app can notify you in three ways: inside the app, through browser push notifications, and through email. These are used for events such as leave approvals or rejections, duty-related reminders, roster changes, comp-off expiry, and license or rating alerts. Email delivery runs through a queued system so important updates can still reach you even when you are away from the app.",
  },
  {
    value: "why-personal-project",
    question: "Why was this built?",
    answer:
      "This is a personal project built to help Kolkata ATCOs reduce routine friction around roster awareness, leave tracking, reminders, and visibility into operational records. The goal is practical usefulness first. Feedback is welcome because improving it together can turn it into something much bigger and more valuable over time.",
  },
  {
    value: "how-report-issue",
    question: "How do I report a problem or suggest an improvement?",
    answer:
      "Use the feedback and support contact details on this page. If you report an issue, include what page you were on, what you expected to happen, what actually happened, and a screenshot if possible. That makes fixes much faster.",
  },
];

function normalizeRole(role: string | null): Role {
  if (role === "admin" || role === "supervisor" || role === "wso" || role === "employee") {
    return role;
  }
  return "employee";
}

function ContactCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  href,
  value,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  actionLabel: string;
  href: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl bg-slate-100 p-2 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
            <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.16em]">
              Direct
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a
              href={href}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel={href.startsWith("http") ? "noreferrer" : undefined}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-300"
            >
              {actionLabel}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{value}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotificationPermissionCard() {
  const { notificationPermission, enableNotifications, isWorking } = usePWAOnboarding();

  const isGranted = notificationPermission === "granted";
  const isDenied = notificationPermission === "denied";
  const isUnsupported = notificationPermission === "unsupported";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-5 w-5" />
          Browser Notification Permission
        </CardTitle>
        <CardDescription>
          Allow this device to receive push notifications directly from ATCORA.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isGranted ? (
          <Alert className="border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Permission granted</AlertTitle>
            <AlertDescription>
              This device can receive browser notifications for approvals, reminders, and updates.
            </AlertDescription>
          </Alert>
        ) : null}

        {isDenied ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Permission blocked</AlertTitle>
            <AlertDescription>
              Notifications are blocked in your browser. Re-enable them from browser site settings, then return here and try again.
            </AlertDescription>
          </Alert>
        ) : null}

        {isUnsupported ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Not supported on this device</AlertTitle>
            <AlertDescription>
              Push notifications are not supported in this browser or the VAPID configuration is missing.
            </AlertDescription>
          </Alert>
        ) : null}

        {!isUnsupported ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button onClick={enableNotifications} disabled={isWorking || isDenied}>
              {isGranted ? "Reconnect Notifications" : "Enable Notifications on This Device"}
            </Button>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Status: <span className="font-medium capitalize">{notificationPermission}</span>
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function AppSettingsPage() {
  const { userRole } = useAuth();
  const [searchParams] = useSearchParams();
  const portalRole = searchParams.get("portal");
  const role = normalizeRole(portalRole || userRole);

  return (
    <DashboardLayout role={role}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <img src="/logo.png" alt="ATCORA" className="mt-1 h-14 w-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-950" />
            <div>
            <div className="flex items-center gap-2">
              <Badge className="rounded-full bg-sky-600 px-3 py-1 text-white hover:bg-sky-600">Settings</Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">ATCORA</Badge>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">App Settings</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Manage your account, notification access, and app information in one place. The most important controls are listed first.
            </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="xl:sticky xl:top-24 xl:self-start">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Settings List</CardTitle>
                <CardDescription>Use this list to jump to each section.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  ["password", "Reset Password"],
                  ["notifications", "Notification Settings"],
                  ["about", "About the App"],
                  ["contact", "Feedback and Problem Contact"],
                  ["faq", "FAQ"],
                  ["privacy", "Privacy and Data Use"],
                ].map(([id, label], index) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                  >
                    <span>{index + 1}. {label}</span>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </a>
                ))}
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-6">
            <section id="password" className="scroll-mt-24">
              <SettingsPasswordForm />
            </section>

            <section id="notifications" className="scroll-mt-24 space-y-4">
              <NotificationPermissionCard />
              <NotificationSettings />
            </section>

            <section id="about" className="scroll-mt-24 space-y-6">
              <Card className="border-slate-200 bg-gradient-to-br from-sky-50 via-white to-slate-50 dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900">
                <CardContent className="p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full bg-sky-600 px-3 py-1 text-white hover:bg-sky-600">Built for Kolkata ATCOs</Badge>
                    <Badge variant="outline" className="rounded-full px-3 py-1">Personal Project</Badge>
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                    ATCORA is a working operations helper for the Kolkata ATCO community.
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700 dark:text-slate-300">
                    This webapp is focused on practical day-to-day needs: checking shifts, staying aware of roster changes,
                    applying for leave, tracking comp-off, monitoring attendance, following duty exchange activity, and keeping
                    an eye on license, rating, medical, and ELPA-related validity. It is intended for Air Traffic Controllers in Kolkata,
                    so the structure of the features follows that working context rather than trying to be a generic HR system.
                  </p>
                </CardContent>
              </Card>

              <div className="grid gap-3 md:grid-cols-2">
                {appHighlights.map((item) => (
                  <div key={item} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                    {item}
                  </div>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BellRing className="h-5 w-5 text-sky-600" />
                    Notification and Email System
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  {notificationHighlights.map((item) => (
                    <div key={item} className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      {item}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-dashed border-sky-300 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/20">
                <CardContent className="p-6">
                  <div className="flex items-center gap-2">
                    <MessagesSquare className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Why feedback matters</h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-300">
                    This is a personal project built to help fellow ATCOs. If the app saves time, avoids confusion, or highlights something
                    missing, that input is valuable. Feedback is appreciated because together we can keep refining this into something bigger,
                    more reliable, and more useful for the people actually doing the work.
                  </p>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Settings className="h-5 w-5 text-sky-600" />
                      Version and update status
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Version</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{appMeta.version}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900">
                      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                        <Clock3 className="h-3.5 w-3.5" />
                        Last Updated
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{appMeta.lastUpdated}</div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>

            <section id="contact" className="scroll-mt-24 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <ContactCard
                  icon={MessageCircleMore}
                  title="Feedback"
                  description="Share ideas, improvements, feature requests, or anything that would make the app more useful for Kolkata ATCOs."
                  actionLabel="Email Feedback"
                  href="mailto:admin@atcora.in?subject=ATCORA%20Feedback"
                  value="admin@atcora.in"
                />
                <ContactCard
                  icon={Bug}
                  title="Problem Reporting"
                  description="If something breaks or behaves incorrectly, send the page name, issue details, and a screenshot if possible."
                  actionLabel="Report by Email"
                  href="mailto:admin@atcora.in?subject=ATCORA%20Issue%20Report"
                  value="admin@atcora.in"
                />
              </div>

              <ContactCard
                icon={Mail}
                title="Telegram Channel"
                description="Use the Telegram channel for updates and direct reach-out when that is easier than email."
                actionLabel="Open Telegram"
                href="https://t.me/atcaro12"
                value="@atcaro12"
              />
            </section>

            <section id="faq" className="scroll-mt-24">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-sky-600" />
                    Frequently Asked Questions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible className="w-full">
                    {faqs.map((item) => (
                      <AccordionItem key={item.value} value={item.value}>
                        <AccordionTrigger className="text-left text-sm text-slate-900 hover:no-underline dark:text-slate-100">
                          {item.question}
                        </AccordionTrigger>
                        <AccordionContent className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                          {item.answer}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            </section>

            <section id="privacy" className="scroll-mt-24">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-sky-600" />
                    Privacy and Data Use
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-6 text-slate-700 dark:text-slate-300">
                  <p>
                    ATCORA stores operational and profile-related data that helps the app deliver schedules, leave workflows,
                    attendance visibility, roster context, and alerting features.
                  </p>
                  <p>
                    Notification-related data may include your notification preferences, push subscription details, and queued email delivery
                    records so the system can send the right alerts to the right users.
                  </p>
                  <p>
                    This app is meant to support Kolkata ATCO workflows. Data shown here is used to make those workflows clearer and more useful,
                    not to add noise. If something looks wrong or overly broad, report it so it can be tightened.
                  </p>
                </CardContent>
              </Card>
            </section>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}