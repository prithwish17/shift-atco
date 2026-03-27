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
import { APP_NAME } from "@/lib/appConfig";
import { cn } from "@/lib/utils";

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

const sectionLinks = [
  ["password", "Reset Password", "Security and account recovery"],
  ["notifications", "Notification Settings", "Browser, push, email, and in-app alerts"],
  ["about", "About the App", "Platform overview and operational scope"],
  ["contact", "Feedback and Problem Contact", "Support channels and issue reporting"],
  ["faq", "FAQ", "Common questions and quick answers"],
  ["privacy", "Privacy and Data Use", "How operational data is used in the app"],
] as const;

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

function SectionFrame({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-[24px] border border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.06)] backdrop-blur md:rounded-[28px] md:p-6 dark:border-slate-800/80 dark:bg-slate-950/80">
      <div className="mb-4 flex flex-col gap-1.5 border-b border-slate-200/80 pb-3 md:mb-5 md:gap-2 md:pb-4 dark:border-slate-800/80">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-sky-700 dark:text-sky-300">{eyebrow}</p>
        <h2 className="text-xl font-semibold tracking-tight text-slate-950 md:text-2xl dark:text-slate-50">{title}</h2>
        <p className="hidden max-w-3xl text-sm leading-6 text-slate-600 sm:block dark:text-slate-300">{description}</p>
      </div>
      {children}
    </section>
  );
}

function OverviewMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "warning"; }) {
  return (
    <div className="rounded-2xl border border-white/12 bg-white/8 p-3 backdrop-blur-sm md:p-4 dark:border-white/10 dark:bg-white/5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">{label}</div>
      <div className={cn(
        "mt-2 text-sm font-semibold",
        tone === "success" ? "text-emerald-300" : tone === "warning" ? "text-amber-300" : "text-white",
      )}>{value}</div>
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
  const { notificationPermission } = usePWAOnboarding();
  const [searchParams] = useSearchParams();
  const portalRole = searchParams.get("portal");
  const role = normalizeRole(portalRole || userRole);

  const notificationStatusLabel = notificationPermission === "unsupported"
    ? "Unsupported on this device"
    : notificationPermission === "granted"
      ? "Enabled"
      : notificationPermission === "denied"
        ? "Blocked"
        : "Needs setup";

  return (
    <DashboardLayout role={role}>
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.2),_transparent_30%),radial-gradient(circle_at_88%_18%,_rgba(134,239,172,0.16),_transparent_18%),linear-gradient(135deg,_#0b1934_0%,_#122849_42%,_#0f172a_100%)] p-5 shadow-[0_24px_80px_rgba(15,23,42,0.16)] md:rounded-[32px] md:p-8">
          <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.08),transparent_28%,transparent_72%,rgba(255,255,255,0.03))]" />
          <div className="relative grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_340px]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-white/15 bg-slate-950/30 shadow-[0_18px_48px_rgba(2,6,23,0.35)] backdrop-blur-md sm:h-20 sm:w-20 sm:rounded-[26px]">
                <img src="/logo.png" alt={APP_NAME} className="h-11 w-11 object-contain sm:h-14 sm:w-14" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="rounded-full border-0 bg-sky-500/90 px-3 py-1 text-[11px] text-white hover:bg-sky-500/90">Settings Hub</Badge>
                  <Badge variant="outline" className="rounded-full border-white/20 bg-white/8 px-3 py-1 text-[11px] text-slate-100">
                    {APP_NAME}
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-[11px] text-emerald-100 capitalize">
                    {role} portal
                  </Badge>
                </div>
                <h1 className="mt-4 whitespace-nowrap text-[2.55rem] font-semibold leading-none tracking-tight text-white sm:text-4xl md:text-5xl">App Settings</h1>
                <p className="mt-4 hidden max-w-3xl text-base leading-8 text-slate-200/90 sm:block">
                  A single place to manage account security, notification delivery, support access, and product information in a way that feels operationally clear and dependable.
                </p>
                <div className="mt-5 hidden flex-wrap gap-3 text-sm text-slate-200/85 sm:flex">
                  <div className="rounded-full border border-white/10 bg-white/8 px-4 py-2">Designed for high-trust HR workflows</div>
                  <div className="rounded-full border border-white/10 bg-white/8 px-4 py-2">Prioritized actions first</div>
                  <div className="rounded-full border border-white/10 bg-white/8 px-4 py-2">Support and governance in one view</div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <OverviewMetric label="Portal" value={`${role[0].toUpperCase()}${role.slice(1)} workspace`} />
              <OverviewMetric label="Notifications" value={notificationStatusLabel} tone={notificationPermission === "granted" ? "success" : notificationPermission === "denied" ? "warning" : "default"} />
              <OverviewMetric label="Release" value={appMeta.version} />
              <OverviewMetric label="Last updated" value={appMeta.lastUpdated} />
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="xl:sticky xl:top-24 xl:self-start">
            <div className="space-y-4">
              <Card className="rounded-[24px] border-slate-200/80 bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.06)] backdrop-blur md:rounded-[28px] dark:border-slate-800/80 dark:bg-slate-950/80">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-slate-950 dark:text-slate-50">Workspace Guide</CardTitle>
                  <CardDescription className="hidden sm:block">Jump straight to the section you need without hunting through the page.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 sm:space-y-2">
                  {sectionLinks.map(([id, label, description], index) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="group flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 transition-all hover:border-sky-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/70 dark:hover:border-sky-800 dark:hover:bg-slate-950"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{index + 1}. {label}</div>
                      <div className="mt-1 hidden text-xs leading-5 text-slate-500 sm:block dark:text-slate-400">{description}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-sky-600" />
                  </a>
                  ))}
                </CardContent>
              </Card>

              <Card className="hidden rounded-[28px] border-slate-200/80 bg-gradient-to-br from-white to-slate-50 shadow-[0_18px_60px_rgba(15,23,42,0.06)] sm:block dark:border-slate-800/80 dark:from-slate-950 dark:to-slate-900">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Support Posture</CardTitle>
                  <CardDescription>Built to feel more like a professional people-operations workspace than a utility page.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  <div className="rounded-2xl bg-slate-100/80 p-4 dark:bg-slate-900">
                    Security-sensitive actions are placed first, notification controls are grouped together, and support information is clearly separated from product guidance.
                  </div>
                  <Button asChild variant="outline" className="w-full justify-between rounded-2xl">
                    <Link to={`/settings?portal=${role}#contact`}>
                      Contact support
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </aside>

          <div className="space-y-6">
            <SectionFrame
              id="password"
              eyebrow="Account Security"
              title="Password and Access Recovery"
              description="Keep account access protected and make sure recovery emails can be sent without friction."
            >
              <SettingsPasswordForm />
            </SectionFrame>

            <SectionFrame
              id="notifications"
              eyebrow="Delivery Controls"
              title="Notification Permissions and Preferences"
              description="Manage how updates reach you across browser push, in-app alerts, and email so important workflow events are never missed."
            >
              <div className="space-y-4">
              <NotificationPermissionCard />
              <NotificationSettings />
              </div>
            </SectionFrame>

            <SectionFrame
              id="about"
              eyebrow="Platform Overview"
              title="Why this workspace exists"
              description="A clearer view of what the app supports, who it serves, and how the broader workflow pieces fit together."
            >
              <div className="space-y-6">
              <Card className="border-slate-200 bg-gradient-to-br from-sky-50 via-white to-slate-50 dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900">
                <CardContent className="p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full bg-sky-600 px-3 py-1 text-white hover:bg-sky-600">Built for Kolkata ATCOs</Badge>
                    <Badge variant="outline" className="rounded-full px-3 py-1">Personal Project</Badge>
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                    {APP_NAME} is a working operations helper for the Kolkata ATCO community.
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
              </div>
            </SectionFrame>

            <SectionFrame
              id="contact"
              eyebrow="Support Channels"
              title="Feedback, problem reporting, and direct contact"
              description="Use the right route depending on whether you are sharing an idea, reporting a fault, or reaching out for operational follow-up."
            >
              <div className="space-y-4">
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
              </div>
            </SectionFrame>

            <SectionFrame
              id="faq"
              eyebrow="Reference"
              title="Frequently asked questions"
              description="Short answers to the questions people usually ask when first using the app or evaluating how it fits into daily operations."
            >
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
            </SectionFrame>

            <SectionFrame
              id="privacy"
              eyebrow="Governance"
              title="Privacy and data use"
              description="A plain-language overview of the data involved in delivering schedules, workflow visibility, and notification features."
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-sky-600" />
                    Privacy and Data Use
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-6 text-slate-700 dark:text-slate-300">
                  <p>
                    {APP_NAME} stores operational and profile-related data that helps the app deliver schedules, leave workflows,
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
            </SectionFrame>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}