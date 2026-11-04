import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { api, ApiError } from "@/lib/api"
import { GiB, MiB, units, type Capacity, type Preset } from "@/lib/environments"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import { FormError, LoadState, NumberField } from "./common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

type Host = {
  id: string
  name: string
  architecture: string
  report: {
    prerequisites_met?: boolean
    system?: {
      cpu?: { logical_cores: number }
      memory?: { total_bytes: number }
    }
  }
}
type Setup = {
  revision: number
  preset: Preset | null
  quota: {
    max_environments: number
    max_running: number
    cpu_millis: number
    memory_bytes: number
  }
  capacity: Capacity
}
const testImage =
  "chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/monkeyai-environment@sha256:619373f2efec51f9147ce867d1d29749719fdcf196c38e30eaf9a9e91b6a887c"

export function HostSetupDialog({
  host,
  close,
  saved,
}: {
  host: Host
  close: () => void
  saved: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const result = useEnvironmentData<Setup>(
    `/api/admin/v1/environment-hosts/${host.id}/setup`
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close()
      }}
    >
      <DialogContent
        className="max-h-[90dvh] w-[calc(100vw_-_2rem)] overflow-y-auto sm:max-w-2xl"
        closeLabel={t("environmentAdmin.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("environmentAdmin.setupTitle")}</DialogTitle>
          <DialogDescription>
            {host.name} · {host.architecture}。
            {t("environmentAdmin.setupDescription")}
          </DialogDescription>
        </DialogHeader>
        <LoadState {...result} empty={false} />
        {result.data && (
          <SetupForm
            host={host}
            value={result.data}
            close={close}
            saved={saved}
            onBusy={setBusy}
            reload={result.refresh}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
function SetupForm({
  host,
  value,
  close,
  saved,
  onBusy,
  reload,
}: {
  host: Host
  value: Setup
  close: () => void
  saved: () => void
  onBusy: (busy: boolean) => void
  reload: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(
    value.preset?.name ?? "Ubuntu 24.04 / runtime 26.1030.1"
  )
  const [image, setImage] = useState(
    value.preset?.configuration.image ??
      (host.architecture === "amd64" ? testImage : "")
  )
  const [enabled, setEnabled] = useState(
    value.capacity.enabled || value.capacity.max_environments === 0
  )
  const resource = value.preset?.configuration.resource
  const [values, setValues] = useState({
    cpu: String((resource?.cpu_millis ?? 2000) / 1000),
    memory: String((resource?.memory_bytes ?? 4 * GiB) / GiB),
    temporary: String((resource?.temporary_bytes ?? 512 * MiB) / MiB),
    tasks: String(resource?.host_tasks ?? 1024),
    quotaCPU: String(value.quota.cpu_millis / 1000),
    quotaMemory: String(value.quota.memory_bytes / GiB),
    environments: String(value.quota.max_environments),
    running: String(value.quota.max_running),
    hostCPU: String(
      value.capacity.cpu_millis / 1000 ||
        Math.max(1, (host.report.system?.cpu?.logical_cores ?? 2) - 1)
    ),
    hostMemory: String(
      value.capacity.memory_bytes / GiB ||
        Math.max(
          1,
          Math.floor(
            (host.report.system?.memory?.total_bytes ?? 5 * GiB) / GiB
          ) - 1
        )
    ),
    hostEnvironments: String(value.capacity.max_environments || 2),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [conflict, setConflict] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError("")
    setConflict(false)
    let body
    try {
      if (
        !name.trim() ||
        new TextEncoder().encode(name.trim()).length > 128 ||
        /[\r\n\t\0]/.test(name) ||
        !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(image.trim())
      )
        throw new Error()
      const profile = {
        architecture: host.architecture,
        image: image.trim(),
        network_policy: "public-only",
        resource: {
          cpu_millis: units(values.cpu, 1000),
          memory_bytes: units(values.memory, GiB),
          temporary_bytes: units(values.temporary, MiB),
          host_tasks: units(values.tasks),
        },
      }
      const quota = {
        max_environments: units(values.environments),
        max_running: units(values.running),
        cpu_millis: units(values.quotaCPU, 1000),
        memory_bytes: units(values.quotaMemory, GiB),
      }
      const capacity = {
        enabled,
        cpu_millis: units(values.hostCPU, 1000),
        memory_bytes: units(values.hostMemory, GiB),
        max_environments: units(values.hostEnvironments),
      }
      if (
        profile.resource.temporary_bytes > profile.resource.memory_bytes / 2 ||
        profile.resource.temporary_bytes % 4096 !== 0 ||
        quota.max_running > quota.max_environments ||
        quota.cpu_millis < profile.resource.cpu_millis ||
        quota.memory_bytes < profile.resource.memory_bytes ||
        (enabled &&
          (capacity.max_environments < 1 ||
            capacity.cpu_millis < profile.resource.cpu_millis ||
            capacity.memory_bytes < profile.resource.memory_bytes))
      )
        throw new Error()
      body = {
        revision: value.revision,
        preset: { name: name.trim(), configuration: profile },
        quota,
        capacity,
      }
    } catch {
      setError(t("environmentAdmin.setupInvalid"))
      return
    }
    setBusy(true)
    onBusy(true)
    try {
      await api(`/api/admin/v1/environment-hosts/${host.id}/setup`, {
        method: "PUT",
        body: JSON.stringify(body),
      })
      saved()
    } catch (error) {
      setConflict(error instanceof ApiError && error.status === 409)
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }
  function number(
    key: keyof typeof values,
    label: string,
    min: number,
    max: number,
    step: number | "any" = 1
  ) {
    return (
      <NumberField
        name={`setup-${key}`}
        label={t(`environmentAdmin.${label}`)}
        value={values[key]}
        onChange={(next) => setValues((old) => ({ ...old, [key]: next }))}
        min={min}
        max={max}
        step={step}
      />
    )
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={busy} className="space-y-5">
        <section className="space-y-4" aria-labelledby="setup-preset-heading">
          <h3 id="setup-preset-heading" className="text-sm font-medium">
            {t("environmentAdmin.setupPreset")}
          </h3>
          <Field>
            <FieldLabel htmlFor="setup-name">
              {t("environmentAdmin.name")}
            </FieldLabel>
            <Input
              id="setup-name"
              required
              maxLength={128}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="setup-image">
              {t("environmentAdmin.image")}
            </FieldLabel>
            <Input
              id="setup-image"
              required
              maxLength={512}
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="registry.example.com/dev@sha256:…"
            />
            <FieldDescription>
              {t("environmentAdmin.setupImageHint")}
            </FieldDescription>
          </Field>
          {value.preset &&
            value.preset.configuration.architecture !== host.architecture && (
              <p role="status" className="text-sm text-destructive">
                {t("environmentAdmin.setupArchitectureHint")}
              </p>
            )}
          <div className="grid gap-4 sm:grid-cols-2">
            {number("cpu", "fields.cpu", 0.1, 256, 0.001)}
            {number("memory", "fields.memoryGiB", 0.25, 1024, "any")}
            {number("temporary", "fields.temporary", 16, 524288)}
            {number("tasks", "fields.tasks", 64, 65536)}
          </div>
        </section>
        <section
          className="space-y-4 border-t pt-5"
          aria-labelledby="setup-quota-heading"
        >
          <h3 id="setup-quota-heading" className="text-sm font-medium">
            {t("environmentAdmin.setupQuota")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("environmentAdmin.setupQuotaHint")}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {number("environments", "fields.environments", 1, 1000)}
            {number("running", "fields.running", 1, 1000)}
            {number("quotaCPU", "fields.cpu", 0.1, 4096, 0.001)}
            {number("quotaMemory", "fields.memoryGiB", 0.25, 16384, "any")}
          </div>
        </section>
        <section
          className="space-y-4 border-t pt-5"
          aria-labelledby="setup-capacity-heading"
        >
          <h3 id="setup-capacity-heading" className="text-sm font-medium">
            {t("environmentAdmin.setupCapacity")}
          </h3>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="setup-enabled">
              {t("environmentAdmin.scheduling")}
            </FieldLabel>
            <Switch
              id="setup-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {number("hostCPU", "fields.cpu", 0, 4096, 0.001)}
            {number("hostMemory", "fields.memoryGiB", 0, 16384, "any")}
            {number("hostEnvironments", "fields.environments", 0, 10000)}
          </div>
          <p className="text-sm text-muted-foreground">
            {t("environmentAdmin.setupCapacityHint")}
          </p>
          {!host.report.prerequisites_met && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("environmentAdmin.setupChecksHint")}
            </p>
          )}
        </section>
      </fieldset>
      <FormError error={error} />
      {conflict && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={reload}
        >
          {t("environmentAdmin.setupReload")}
        </Button>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={close}>
          {t("environmentAdmin.cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {t(`environmentAdmin.${busy ? "saving" : "save"}`)}
        </Button>
      </DialogFooter>
    </form>
  )
}
