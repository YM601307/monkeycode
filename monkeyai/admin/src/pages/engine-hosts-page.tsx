import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  EnvironmentFrame,
  EnvironmentTable,
  Pagination,
  Identity,
} from "@/components/environments/common"
import { HostSetupDialog } from "@/components/environments/host-setup-dialog"
import { ResourceMeter } from "@/components/environments/resource-meter"
import { HugeiconsIcon } from "@hugeicons/react"
import { ComputerCloudIcon, Add01Icon } from "@hugeicons/core-free-icons"
import { OSIcon } from "@/components/environments/os-icon"
import { HostCommand } from "@/components/environments/host-command"
import { rememberCommand } from "@/lib/host-command"
import { useAuth } from "@/hooks/use-auth"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import { TableCell, TableRow } from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"

type Usage = {
  total_bytes: number
  used_bytes: number
  available_bytes: number
}
type HostSystem = {
  hostname: string
  os_name: string
  kernel_version: string
  cpu?: { model: string; logical_cores: number; usage_percent?: number }
  memory?: Usage
  disk?: Usage & { path: string }
}
function bytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—"
  const unit = value >= 1024 ** 4 ? "TiB" : value >= 1024 ** 3 ? "GiB" : "MiB"
  const scale =
    unit === "TiB" ? 1024 ** 4 : unit === "GiB" ? 1024 ** 3 : 1024 ** 2
  return `${(value / scale).toFixed(1)} ${unit}`
}
function usage(value?: Usage) {
  return value && value.total_bytes > 0
    ? (value.used_bytes / value.total_bytes) * 100
    : undefined
}

type Host = {
  id: string
  name: string
  architecture: string
  version: string
  status: "pending" | "active" | "revoked"
  online: boolean
  enrollment_expires_at: string
  last_seen_at: string | null
  report: {
    at?: string
    os?: string
    system?: HostSystem
    prerequisites_met?: boolean
    checks?: { name: string; passed: boolean; detail: string }[]
  }
}
type Enrollment = {
  host_id: string
  command: string
  version: string
  expires_at: string
}

export function EngineHostsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const text = (key: string, options?: Record<string, string | number>) =>
    t(`pages.engineHosts.${key}`, options)
  const [page, setPage] = useState(1)
  const [formError, setFormError] = useState("")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [revoking, setRevoking] = useState<Host | null>(null)
  const [revokeError, setRevokeError] = useState("")
  const [removing, setRemoving] = useState(false)
  const [notice, setNotice] = useState("")

  const [configuring, setConfiguring] = useState<Host | null>(null)
  const [checking, setChecking] = useState<Host | null>(null)
  const result = useEnvironmentData<{ items: Host[]; total: number }>(
    `/api/admin/v1/engine-hosts?page=${page}&page_size=20`,
    true
  )
  const hosts = result.data?.items ?? []
  const total = result.data?.total ?? 0
  const refresh = result.refresh
  const detail = hosts.find((host) => host.id === checking?.id) ?? checking

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  async function create() {
    if (busy) return
    setOpen(true)
    setBusy(true)
    setFormError("")
    setCopied(false)
    try {
      const result = await api<Enrollment>(
        "/api/admin/v1/engine-host-enrollments",
        {
          method: "POST",
          body: "{}",
        }
      )
      setEnrollment(result)
      rememberCommand(user?.id ?? "", result)
      setPage(1)
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : text("createFailed"))
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    if (!enrollment) return
    try {
      await navigator.clipboard.writeText(enrollment.command)
      setCopied(true)
      setFormError("")
    } catch {
      setFormError(text("copyFailed"))
    }
  }
  async function confirmHostAction() {
    if (!revoking || busy) return
    setBusy(true)
    setRevokeError("")
    try {
      await api(
        `/api/admin/v1/engine-hosts/${revoking.id}${removing ? "/record" : ""}`,
        {
          method: "DELETE",
        }
      )
      if (enrollment?.host_id === revoking.id) setEnrollment(null)
      if (removing && checking?.id === revoking.id) setChecking(null)
      setNotice(text(removing ? "deleteSuccess" : "revokeSuccess"))
      setRevoking(null)
      if (removing && hosts.length === 1 && page > 1) setPage(page - 1)
      else refresh()
    } catch (err) {
      setRevokeError(
        err instanceof Error
          ? err.message
          : text(removing ? "deleteFailed" : "revokeFailed")
      )
    } finally {
      setBusy(false)
    }
  }
  const expired =
    enrollment !== null && new Date(enrollment.expires_at).getTime() <= now
  const close = (value: boolean) => {
    if (busy) return
    setOpen(value)
    if (!value) {
      setEnrollment(null)
      setFormError("")
      setCopied(false)
    }
  }
  return (
    <EnvironmentFrame
      table
      title={text("title")}
      description={text("description")}
      action={
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" disabled={result.loading} onClick={refresh}>
            {t("environmentAdmin.refresh")}
          </Button>
          <Button disabled={busy} onClick={() => void create()}>
            <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
            {text("add")}
          </Button>
        </div>
      }
    >
      {notice && (
        <p
          role="status"
          className="px-[var(--card-spacing)] py-3 text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}
      <EnvironmentTable
        title={text("title")}
        columns={[
          text("name"),
          t("environmentAdmin.status"),
          text("system"),
          "CPU",
          text("memory"),
          text("disk"),
          t("environmentAdmin.actions"),
        ]}
        {...result}
        empty={!hosts.length}
      >
        {hosts.map((host) => {
          const status =
            host.status === "revoked"
              ? "revoked"
              : host.status === "pending"
                ? new Date(host.enrollment_expires_at).getTime() <= now
                  ? "expired"
                  : "pending"
                : host.online
                  ? "online"
                  : "offline"
          const system = host.report.system
          const stale = !host.online || host.status !== "active"
          return (
            <TableRow key={host.id}>
              <TableCell className="ps-[var(--card-spacing)]">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <HugeiconsIcon
                      icon={ComputerCloudIcon}
                      size={18}
                      aria-hidden="true"
                    />
                  </span>
                  <div className="min-w-0">
                    <Button
                      variant="link"
                      className="h-auto max-w-48 justify-start truncate p-0 font-medium"
                      title={host.name}
                      onClick={() => setChecking(host)}
                    >
                      {host.name}
                    </Button>
                    <p
                      className="mt-1 max-w-48 truncate font-mono text-xs text-muted-foreground"
                      title={system?.hostname || host.id}
                    >
                      {system?.hostname || host.id}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={stale ? "outline" : "secondary"}>
                  {text(status)}
                </Badge>
                {host.report.checks?.length ? (
                  <button
                    type="button"
                    className="mt-1.5 block cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => setChecking(host)}
                  >
                    {host.report.prerequisites_met
                      ? text("checksPassed")
                      : text("checksFailed")}
                  </button>
                ) : null}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <OSIcon name={system?.os_name} />
                  <p className="max-w-48 truncate" title={system?.os_name}>
                    {system?.os_name && system.os_name.toLowerCase() !== "linux"
                      ? system.os_name
                      : text("notReported")}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {host.status === "pending" ? "—" : host.architecture} ·{" "}
                  {host.version}
                </p>
              </TableCell>
              <TableCell>
                <ResourceMeter
                  label={text("cpuUsage")}
                  value={system?.cpu?.usage_percent}
                  stale={stale}
                  detail={
                    system?.cpu
                      ? text("cores", { count: system.cpu.logical_cores })
                      : text("notReported")
                  }
                />
              </TableCell>
              <TableCell>
                <ResourceMeter
                  label={text("memoryUsage")}
                  value={usage(system?.memory)}
                  stale={stale}
                  detail={
                    system?.memory
                      ? `${bytes(system.memory.used_bytes)} / ${bytes(system.memory.total_bytes)}`
                      : text("notReported")
                  }
                />
              </TableCell>
              <TableCell>
                <ResourceMeter
                  label={text("diskUsage")}
                  value={usage(system?.disk)}
                  stale={stale}
                  detail={
                    system?.disk
                      ? `${bytes(system.disk.used_bytes)} / ${bytes(system.disk.total_bytes)}`
                      : text("notReported")
                  }
                />
              </TableCell>
              <TableCell className="pe-[var(--card-spacing)]">
                <div className="flex gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={host.status !== "active" || busy}
                    onClick={() => setConfiguring(host)}
                  >
                    {t("environmentAdmin.setupAction")}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setChecking(host)}
                  >
                    {t("environmentAdmin.details")}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={host.status === "revoked" || busy}
                    onClick={() => {
                      setRevoking(host)
                      setRemoving(false)
                      setNotice("")
                      setRevokeError("")
                    }}
                  >
                    {text("revoke")}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => {
                      setRevoking(host)
                      setRemoving(true)
                      setNotice("")
                      setRevokeError("")
                    }}
                  >
                    {text("delete")}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </EnvironmentTable>
      {configuring && (
        <HostSetupDialog
          host={configuring}
          close={() => setConfiguring(null)}
          saved={() => {
            setConfiguring(null)
            setNotice(t("environmentAdmin.setupSaved"))
            refresh()
          }}
        />
      )}
      <Pagination
        page={page}
        count={hosts.length}
        total={total}
        disabled={result.loading || !!result.error || busy}
        onChange={setPage}
      />
      <Dialog
        open={!!checking}
        onOpenChange={(value) => {
          if (!value) setChecking(null)
        }}
      >
        <DialogContent
          className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl"
          closeLabel={text("close")}
        >
          <DialogHeader>
            <DialogTitle>{text("details")}</DialogTitle>
            <DialogDescription className="break-all">
              {detail?.name}
              {detail && !detail.online && ` · ${text("lastReport")}`}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="-me-3 flex min-h-0 flex-1 flex-col [&_[data-slot=scroll-area-viewport]]:min-h-0">
            {detail && (
              <div className="space-y-6 pe-3">
                {detail.status === "pending" && (
                  <HostCommand
                    key={detail.id}
                    host={detail}
                    refresh={refresh}
                  />
                )}
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Identity
                    label={text("hostname")}
                    value={
                      detail.report.system?.hostname || text("notReported")
                    }
                  />
                  <Identity
                    label={t("environmentAdmin.host")}
                    value={detail.id}
                  />
                  <Identity
                    label={text("system")}
                    value={
                      detail.report.system?.os_name &&
                      detail.report.system.os_name.toLowerCase() !== "linux"
                        ? detail.report.system.os_name
                        : text("notReported")
                    }
                  />
                  <Identity
                    label={text("kernel")}
                    value={
                      detail.report.system?.kernel_version ||
                      text("notReported")
                    }
                  />
                  <Identity
                    label={text("architecture")}
                    value={
                      detail.status === "pending" ? "—" : detail.architecture
                    }
                  />
                  <Identity
                    label={t("environmentAdmin.version")}
                    value={detail.version}
                  />
                  <Identity
                    label={text("cpuModel")}
                    value={
                      detail.report.system?.cpu?.model || text("notReported")
                    }
                  />
                  <Identity
                    label={text("lastSeen")}
                    value={
                      detail.last_seen_at
                        ? new Date(detail.last_seen_at).toLocaleString()
                        : "—"
                    }
                  />
                </dl>
                <section
                  className="space-y-4 rounded-lg border p-4"
                  aria-label={text("resourceUsage")}
                >
                  <div>
                    <h3 className="text-sm font-medium">
                      {text("resourceUsage")}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {text("metricsHint")}
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">CPU</p>
                      <ResourceMeter
                        label={text("cpuUsage")}
                        value={detail.report.system?.cpu?.usage_percent}
                        stale={!detail.online}
                        detail={
                          detail.report.system?.cpu
                            ? text("cores", {
                                count: detail.report.system.cpu.logical_cores,
                              })
                            : text("notReported")
                        }
                      />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {text("memory")}
                      </p>
                      <ResourceMeter
                        label={text("memoryUsage")}
                        value={usage(detail.report.system?.memory)}
                        stale={!detail.online}
                        detail={
                          detail.report.system?.memory
                            ? `${bytes(detail.report.system.memory.used_bytes)} / ${bytes(detail.report.system.memory.total_bytes)}`
                            : text("notReported")
                        }
                      />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {text("disk")}
                      </p>
                      <ResourceMeter
                        label={text("diskUsage")}
                        value={usage(detail.report.system?.disk)}
                        stale={!detail.online}
                        detail={
                          detail.report.system?.disk
                            ? `${bytes(detail.report.system.disk.used_bytes)} / ${bytes(detail.report.system.disk.total_bytes)}`
                            : text("notReported")
                        }
                      />
                    </div>
                  </div>
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <Identity
                      label={text("dataDir")}
                      value={
                        detail.report.system?.disk?.path || text("notReported")
                      }
                    />
                    <Identity
                      label={text("diskAvailable")}
                      value={
                        detail.report.system?.disk
                          ? bytes(detail.report.system.disk.available_bytes)
                          : text("notReported")
                      }
                    />
                  </dl>
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-medium">
                    {t("environmentAdmin.checks")}
                  </h3>
                  {!detail.report.checks?.length ? (
                    <p className="text-sm text-muted-foreground">
                      {text("notReported")}
                    </p>
                  ) : (
                    <ul className="space-y-4">
                      {detail.report.checks.map((check) => (
                        <li key={check.name} className="space-y-1 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                check.passed ? "secondary" : "destructive"
                              }
                            >
                              {check.passed ? text("passed") : text("failed")}
                            </Badge>
                            <span className="break-all font-medium">
                              {check.name}
                            </span>
                          </div>
                          <p className="break-words text-muted-foreground">
                            {check.detail}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChecking(null)}>
              {text("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent
          className="min-w-0 [&>*]:min-w-0"
          closeLabel={text("close")}
        >
          <DialogHeader>
            <DialogTitle>{text("add")}</DialogTitle>
            <DialogDescription>{text("commandHint")}</DialogDescription>
          </DialogHeader>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          {enrollment ? (
            <div className="space-y-4">
              <p
                role="status"
                className={
                  expired
                    ? "text-sm text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                {expired
                  ? text("commandExpired")
                  : `${text("expires")}：${new Date(enrollment.expires_at).toLocaleString()}`}
              </p>
              <Field>
                <FieldLabel htmlFor="engine-command">
                  {text("command")}
                </FieldLabel>
                <Textarea
                  id="engine-command"
                  readOnly
                  value={expired ? "" : enrollment.command}
                  className="min-h-28 w-full min-w-0 max-w-full resize-none break-all font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </Field>
              <DialogFooter>
                <Button variant="outline" onClick={() => close(false)}>
                  {text("close")}
                </Button>
                <Button disabled={expired} onClick={() => void copy()}>
                  {copied ? text("copied") : text("copy")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              {busy && (
                <p role="status" className="text-sm text-muted-foreground">
                  {text("creating")}
                </p>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => close(false)}
                >
                  {text("close")}
                </Button>
                {!busy && (
                  <Button onClick={() => void create()}>{text("retry")}</Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!revoking}
        onOpenChange={(value) => {
          if (!value && !busy) setRevoking(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {text(removing ? "delete" : "revoke")}：{revoking?.name}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {text(removing ? "deleteHint" : "revokeHint")}
          </AlertDialogDescription>
          {revokeError && (
            <p role="alert" className="text-sm text-destructive">
              {revokeError}
            </p>
          )}
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRevoking(null)}
            >
              {text("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmHostAction()}
            >
              {busy ? text("processing") : text(removing ? "delete" : "revoke")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EnvironmentFrame>
  )
}
