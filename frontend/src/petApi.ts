export type PetRecord = {
  id: number
  name: string
  birthDate: string
  type: { id: number; name: string }
  ownerId: number
}

export type OwnerSummary = { id: number; firstName: string; lastName: string }

const apiBaseUrl = (import.meta.env.VITE_AGENT_API_BASE_URL || '').replace(/\/+$/, '')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function parsePet(value: unknown): PetRecord {
  if (!isRecord(value) || !isId(value.id) || typeof value.name !== 'string' || !value.name.trim()
    || typeof value.birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.birthDate)
    || !isRecord(value.type) || !isId(value.type.id) || typeof value.type.name !== 'string'
    || !value.type.name.trim() || !isId(value.ownerId)) {
    throw new Error('The pet records response is invalid.')
  }
  return value as PetRecord
}

async function read(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl}/api${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Pet records could not be loaded (HTTP ${response.status}).`)
  return response.json()
}

export async function listPets(signal: AbortSignal): Promise<PetRecord[]> {
  const value = await read('/pets', signal)
  if (!Array.isArray(value)) throw new Error('The pet list response is invalid.')
  const pets = value.map(parsePet)
  if (new Set(pets.map(pet => pet.id)).size !== pets.length) throw new Error('The pet list contains duplicate IDs.')
  return pets
}

export async function getPet(id: number, signal: AbortSignal): Promise<PetRecord> {
  const pet = parsePet(await read(`/pets/${id}`, signal))
  if (pet.id !== id) throw new Error('The pet records response contains a different pet.')
  return pet
}

export async function getOwner(id: number, signal: AbortSignal): Promise<OwnerSummary> {
  const value = await read(`/owners/${id}`, signal)
  if (!isRecord(value) || value.id !== id || typeof value.firstName !== 'string' || typeof value.lastName !== 'string') {
    throw new Error('The owner response is invalid.')
  }
  return value as OwnerSummary
}
