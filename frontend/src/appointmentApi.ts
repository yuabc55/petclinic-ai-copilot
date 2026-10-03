export type VetSummary = { id: number; firstName: string; lastName: string }
export type AppointmentStatus = 'REQUESTED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
export type AppointmentRecord = {
  id: number
  petId: number
  vetId: number
  startAt: string
  status: AppointmentStatus
  createdAt: string
  version: number
}

const apiBaseUrl = (import.meta.env.VITE_AGENT_API_BASE_URL || '').replace(/\/+$/, '')
const statuses: readonly string[] = ['REQUESTED', 'CONFIRMED', 'CANCELLED', 'COMPLETED']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647
}

function isDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!parts) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHour, offsetMinute] = parts
  const year = Number(yearText), month = Number(monthText), day = Number(dayText)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(hourText) < 24 && Number(minuteText) < 60 && Number(secondText) < 60
    && (!offsetHour || (Number(offsetHour) < 24 && Number(offsetMinute) < 60))
    && Number.isFinite(Date.parse(value))
}

function parseVet(value: unknown): VetSummary {
  if (!isRecord(value) || !isId(value.id) || typeof value.firstName !== 'string' || !value.firstName.trim()
    || typeof value.lastName !== 'string' || !value.lastName.trim()) {
    throw new Error('The veterinarian response is invalid.')
  }
  return { id: value.id, firstName: value.firstName, lastName: value.lastName }
}

function parseAppointment(value: unknown): AppointmentRecord {
  if (!isRecord(value) || !isId(value.id) || !isId(value.petId) || !isId(value.vetId)
    || !isDateTime(value.startAt) || !isDateTime(value.createdAt)
    || typeof value.status !== 'string' || !statuses.includes(value.status)
    || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 0) {
    throw new Error('The appointment response is invalid.')
  }
  return value as AppointmentRecord
}

function uniqueIds(records: { id: number }[]) {
  if (new Set(records.map(record => record.id)).size !== records.length) {
    throw new Error('The response contains duplicate IDs.')
  }
}

async function read(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl}/api${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Clinic records could not be loaded (HTTP ${response.status}).`)
  return response.json()
}

export async function listVets(signal: AbortSignal): Promise<VetSummary[]> {
  const value = await read('/vets', signal)
  if (!Array.isArray(value)) throw new Error('The veterinarian list response is invalid.')
  const vets = value.map(parseVet)
  uniqueIds(vets)
  return vets
}

export async function listVetAppointments(vetId: number, signal: AbortSignal): Promise<AppointmentRecord[]> {
  if (!isId(vetId)) throw new Error('The veterinarian ID is invalid.')
  const value = await read(`/vets/${vetId}/appointments`, signal)
  if (!Array.isArray(value)) throw new Error('The appointment list response is invalid.')
  const appointments = value.map(parseAppointment)
  uniqueIds(appointments)
  if (appointments.some(record => record.vetId !== vetId)) throw new Error('The appointment list contains a different veterinarian.')
  return appointments
}

export async function getAppointment(id: number, signal: AbortSignal): Promise<AppointmentRecord> {
  if (!isId(id)) throw new Error('The appointment ID is invalid.')
  const record = parseAppointment(await read(`/appointments/${id}`, signal))
  if (record.id !== id) throw new Error('The response contains a different appointment.')
  return record
}
