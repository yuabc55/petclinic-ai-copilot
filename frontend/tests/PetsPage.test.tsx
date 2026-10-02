import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PetsPage } from '../src/PetsPage'
import { App } from '../src/App'

const pet = { id: 1, name: 'test-pet', birthDate: '2020-09-07', type: { id: 1, name: 'cat' }, ownerId: 1 }
const owner = { id: 1, firstName: 'test', lastName: 'owner' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

describe('Read-only pet records', () => {
  let container: HTMLDivElement
  let root: Root
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
  const openAgent = vi.fn()
  const askPet = vi.fn()

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    openAgent.mockReset()
    askPet.mockReset()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    localStorage.clear()
    vi.unstubAllGlobals()
  })
  async function render() {
    await act(async () => root.render(<PetsPage onOpenAgent={openAgent} onAskPet={askPet} />))
  }
  async function click(selector: string) {
    await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click())
  }

  it('reads real list, pet and owner endpoints, with focus restoration and contextual Copilot entry', async () => {
    fetchMock.mockResolvedValueOnce(json([pet])).mockResolvedValueOnce(json(pet)).mockResolvedValueOnce(json(owner))
    await render()
    expect(container.querySelector('h2')!.textContent).toContain('1')
    expect(container.querySelector('time')!.textContent).toBe(pet.birthDate)
    expect(container.querySelector('.pets-table-scroll')!.getAttribute('tabindex')).toBe('0')
    const button = container.querySelector<HTMLButtonElement>('[aria-label="View test-pet, pet 1"]')!
    await act(async () => button.click())
    const detail = container.querySelector<HTMLElement>('#pet-details')!
    expect(detail.textContent).toContain('test owner')
    expect(document.activeElement).toBe(detail)
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/pets', '/api/pets/1', '/api/owners/1'])
    await click('.pet-copilot-action')
    expect(askPet).toHaveBeenCalledWith(1)
    await act(async () => detail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('#pet-details')).toBeNull()
    expect(document.activeElement).toBe(button)
    await click('.pets-agent-entry')
    expect(openAgent).toHaveBeenCalledOnce()
  })

  it('distinguishes an empty array from HTTP errors and supports retry without invented totals', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'Not found' }, 404)).mockResolvedValueOnce(json([]))
    await render()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('HTTP 404')
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('h2')!.textContent).toBe('Pet directory')
    await click('.pets-query-error button')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[role="status"]')!.textContent).toContain('No pet records')
    expect(container.querySelector('h2')!.textContent).toContain('0')
  })

  it('rejects malformed lists and duplicate IDs', async () => {
    fetchMock.mockResolvedValueOnce(json({ pets: [pet] })).mockResolvedValueOnce(json([pet, pet]))
    await render()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('invalid')
    await click('.pets-query-error button')
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('duplicate IDs')
    expect(container.querySelector('table')).toBeNull()
  })

  it('keeps the pet visible when owner lookup fails, and retries owner details', async () => {
    fetchMock.mockResolvedValueOnce(json([pet])).mockResolvedValueOnce(json(pet)).mockResolvedValueOnce(json({}, 403))
      .mockResolvedValueOnce(json(pet)).mockResolvedValueOnce(json(owner))
    await render()
    await click('tbody button')
    expect(container.querySelector('#pet-details time')!.textContent).toBe(pet.birthDate)
    expect(container.querySelector('#pet-details [role="alert"]')!.textContent).toContain('HTTP 403')
    expect(container.querySelector('#pet-details')!.textContent).toContain('Owner #1')
    await click('#pet-details .pets-query-error button')
    expect(container.querySelector('#pet-details [role="alert"]')).toBeNull()
    expect(container.querySelector('#pet-details')!.textContent).toContain('test owner')
  })

  it('aborts obsolete detail requests and ignores their late responses', async () => {
    const second = { ...pet, id: 2, name: 'other-pet' }
    let finishOld!: (response: Response) => void
    fetchMock.mockResolvedValueOnce(json([pet, second])).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce(json(second)).mockResolvedValueOnce(json(owner))
    await render()
    await click('[aria-label="View test-pet, pet 1"]')
    const oldSignal = fetchMock.mock.calls[1][1]!.signal!
    await click('[aria-label="View other-pet, pet 2"]')
    expect(oldSignal.aborted).toBe(true)
    await act(async () => finishOld(json(pet)))
    expect(container.querySelector('#pet-detail-heading')!.textContent).toBe('other-pet')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('integrates with navigation and opens the existing Drawer without sending a model request', async () => {
    fetchMock.mockResolvedValueOnce(json([pet])).mockResolvedValueOnce(json(pet)).mockResolvedValueOnce(json(owner))
    await act(async () => root.render(<App />))
    await click('button[aria-label="Pets"]')
    expect(container.querySelector('.pets-scene')).not.toBeNull()
    await click('tbody button')
    await click('.pet-copilot-action')
    expect(container.querySelector('.agent-drawer')).not.toBeNull()
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message Agent"]')!.value).toBe('Show pet 1')
    expect(fetchMock.mock.calls.every(call => String(call[0]).startsWith('/api/'))).toBe(true)
    await click('button[aria-label="Vets"]')
    expect(container.querySelector('.pets-page')).toBeNull()
  })
})
