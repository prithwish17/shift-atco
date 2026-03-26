import { SettingsPasswordForm } from "@/components/SettingsPasswordForm";
import { NotificationSettings } from "@/components/NotificationSettings";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BellRing,
  Bug,
  Clock3,
  ExternalLink,
  Info,
  KeyRound,
  Mail,
  MessageCircleMore,
  MessagesSquare,
  Settings,
  ShieldCheck,
} from "lucide-react";

interface AppSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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
      "Use the feedback and support contact details in this settings panel. If you report an issue, include what page you were on, what you expected to happen, what actually happened, and a screenshot if possible. That makes fixes much faster.",
  },
];

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

export function AppSettingsDialog({ open, onOpenChange }: AppSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-hidden border-slate-200 p-0 dark:border-slate-800">
        <DialogHeader className="border-b border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 px-6 py-5 text-left dark:border-slate-800">
          <DialogTitle className="flex items-center gap-2 text-xl text-white">
            <Info className="h-5 w-5 text-sky-300" />
            App Settings
          </DialogTitle>
          <DialogDescription className="max-w-2xl text-slate-300">
            Information, support contacts, FAQ, and notification preferences for ATCORA.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="about" className="flex h-full flex-col">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <TabsList className="h-auto flex-wrap justify-start gap-2 rounded-2xl bg-slate-100 p-1.5 dark:bg-slate-900">
              <TabsTrigger value="about" className="rounded-xl">About</TabsTrigger>
              <TabsTrigger value="faq" className="rounded-xl">FAQ</TabsTrigger>
              <TabsTrigger value="contact" className="rounded-xl">Contact</TabsTrigger>
              <TabsTrigger value="notifications" className="rounded-xl">Notifications</TabsTrigger>
              <TabsTrigger value="account" className="rounded-xl">Account</TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="h-[calc(88vh-132px)]">
            <div className="px-4 py-4 sm:px-6 sm:py-5">
              <TabsContent value="about" className="mt-0 space-y-6">
                <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-sky-50 via-white to-slate-50 p-5 dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full bg-sky-600 px-3 py-1 text-white hover:bg-sky-600">Built for Kolkata ATCOs</Badge>
                    <Badge variant="outline" className="rounded-full px-3 py-1">Personal Project</Badge>
                  </div>
                  <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                    ATCORA is a working operations helper for the Kolkata ATCO community.
                  </h3>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700 dark:text-slate-300">
                    This webapp is focused on practical day-to-day needs: checking shifts, staying aware of roster changes,
                    applying for leave, tracking comp-off, monitoring attendance, following duty exchange activity, and keeping
                    an eye on license, rating, medical, and ELPA-related validity. It is intended for Air Traffic Controllers in Kolkata,
                    so the structure of the features follows that working context rather than trying to be a generic HR system.
                  </p>
                </section>

                <section className="grid gap-3 md:grid-cols-2">
                  {appHighlights.map((item) => (
                    <div key={item} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                      {item}
                    </div>
                  ))}
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex items-center gap-2">
                    <BellRing className="h-5 w-5 text-sky-600" />
                    <h4 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Notification and Email System</h4>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {notificationHighlights.map((item) => (
                      <div key={item} className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {item}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-dashed border-sky-300 bg-sky-50 p-5 dark:border-sky-900 dark:bg-sky-950/20">
                  <div className="flex items-center gap-2">
                    <MessagesSquare className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                    <h4 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Why feedback matters</h4>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-300">
                    This is a personal project built to help fellow ATCOs. If the app saves time, avoids confusion, or highlights something
                    missing, that input is valuable. Feedback is appreciated because together we can keep refining this into something bigger,
                    more reliable, and more useful for the people actually doing the work.
                  </p>
                </section>

                <section className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex items-center gap-2">
                      <Settings className="h-5 w-5 text-sky-600" />
                      <h4 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Version and update status</h4>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-sky-600" />
                      <h4 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Privacy and data use</h4>
                    </div>
                    <div className="mt-4 space-y-3 text-sm leading-6 text-slate-700 dark:text-slate-300">
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
                    </div>
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="faq" className="mt-0">
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <div className="mb-4 flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-sky-600" />
                    <h4 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Frequently Asked Questions</h4>
                  </div>
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
                </div>
              </TabsContent>

              <TabsContent value="contact" className="mt-0 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <ContactCard
                    icon={MessageCircleMore}
                    title="Feedback"
                    description="Share ideas, improvements, feature requests, or anything that would make the app more useful for Kolkata ATCOs."
                    actionLabel="Email Feedback"
                    href="mailto:admin@atcora.in?subject=SHIFT%20ATCO%20Feedback"
                    value="admin@atcora.in"
                  />
                  <ContactCard
                    icon={Bug}
                    title="Problem Reporting"
                    description="If something breaks or behaves incorrectly, send the page name, issue details, and a screenshot if possible."
                    actionLabel="Report by Email"
                    href="mailto:admin@atcora.in?subject=SHIFT%20ATCO%20Issue%20Report"
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
              </TabsContent>

              <TabsContent value="notifications" className="mt-0 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  Use these settings to control how different events reach you. Push is best for immediate alerts, in-app is best while you are
                  already signed in, and email is useful when you want a durable record or may miss live updates.
                </div>
                <NotificationSettings />
              </TabsContent>

              <TabsContent value="account" className="mt-0 space-y-4">
                <SettingsPasswordForm onSuccess={() => onOpenChange(false)} />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}