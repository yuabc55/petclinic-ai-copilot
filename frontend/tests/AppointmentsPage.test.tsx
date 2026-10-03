import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppointmentsPage } from '../src/AppointmentsPage'
import { getAppointment, listVetAppointments, listVets, type AppointmentRecord } from '../src/appointmentApi'
import { App } from '../src/App'

// Synthetic contract fixtures; these are not production records.
const vets = [{ id: 7, firstName: 'Test', lastName: 'Veterinarian' }, { id: 8, firstName: 'Other', lastName: 'Veterinarian' }]
const appointment: AppointmentRecord = { id: 42, petId: 3, vetId: 7, startAt: '2020-02-29T10:15:00+02:00', status: 'REQUESTED', createdAt: '2020-02-28T18:30:00Z', version: 0 }
const second: AppointmentRecord = { ...appointment, id: 43, petId: 4, status: 'CONFIRMED' }
const pet = { id: 3, name: 'test-pet', birthDate: '2019-01-01', type: { id: 1, name: 'cat' }, ownerId: 1 }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(finish => { resolve = finish })
  return { promise, resolve }
}

describe('Read-only appointment records', () => {
  let container: HTMLDivElement
  let root: Root
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
  let responses: Record<string, unknown>
  const openAgent = vi.fn()
  const askAppointment = vi.fn()

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    responses = { '/api/vets': vets, '/api/vets/7/appointments': [appointment, second], '/api/vets/8/appointments': [],
      '/api/appointments/42': appointment, '/api/appointments/43': second, '/api/pets/3': pet, '/api/pets/4': { ...pet, id: 4, name: 'other-pet' } }
    fetchMock = vi.fn<typeof fetch>().mockImplementation(async path => {
      if (!(String(path) in responses)) throw new Error(`Unexpected request: ${path}`)
      return json(responses[String(path)])
    })
    vi.stubGlobal('fetch', fetchMock)
    openAgent.mockReset()
    askAppointment.mockReset()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    localStorage.clear()
    vi.unstubAllGlobals()
  })
  async function render() {
    await act(async () => root.render(<AppointmentsPage onOpenAgent={openAgent} onAskAppointment={askAppointment} />))
  }
  async function click(selector: string) {
    await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click())
  }
  async function select(id = '7') {
    await act(async () => {
      const input = container.querySelector<HTMLSelectElement>('#appointment-vet')!
      input.value = id
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  async function list() { await render(); await select() }
  const urls = () => fetchMock.mock.calls.map(call => String(call[0]))
  const signalAt = (index: number) => fetchMock.mock.calls[index][1]!.signal!

  it('loads only the directory initially and requires an explicit veterinarian selection', async () => {
    await render()
    expect(urls()).toEqual(['/api/vets'])
    expect(container.querySelector('select')!.value).toBe('')
    expect(container.querySelector('label')!.htmlFor).toBe('appointment-vet')
    expect(container.textContent).toContain('Select a veterinarian to view their appointments.')
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('h2')!.textContent).toBe('Appointment directory')
    expect(container.querySelector('option')!.textContent).toBe('Select a veterinarian')
  })

  it('exposes directory and list loading states without showing successful counts', async () => {
    const directory = deferred(), rows = deferred()
    fetchMock.mockReturnValueOnce(directory.promise).mockReturnValueOnce(rows.promise)
    await render()
    expect(container.querySelector('select')!.disabled).toBe(true)
    expect(container.textContent).toContain('Loading veterinarians')
    await act(async () => directory.resolve(json(vets)))
    await select()
    expect(container.querySelector('.appointments-directory')!.getAttribute('aria-busy')).toBe('true')
    expect(container.textContent).toContain('Loading appointments')
    expect(container.querySelector('h2')!.textContent).not.toContain('appointments returned')
    await act(async () => rows.resolve(json([appointment])))
    expect(container.querySelector('h2')!.textContent).toContain('1 appointments returned')
  })

  it('shows scoped counts, all four statuses, UTC times and real IDs without per-row pet calls', async () => {
    responses['/api/vets/7/appointments'] = ['REQUESTED', 'CONFIRMED', 'CANCELLED', 'COMPLETED'].map((status, index) => ({ ...appointment, id: 42 + index, status }))
    await list()
    expect(container.querySelector('h2')!.textContent).toContain('Test Veterinarian · Vet #7 · 4 appointments returned')
    expect(Array.from(container.querySelectorAll('.appointment-status')).map(node => node.textContent)).toEqual(['REQUESTED', 'CONFIRMED', 'CANCELLED', 'COMPLETED'])
    expect(container.querySelector('time')!.textContent).toBe('29 Feb 2020, 08:15:00 UTC')
    expect(container.querySelector('time')!.dateTime).toBe(appointment.startAt)
    expect(container.querySelector('tbody')!.textContent).toContain('Pet #3')
    expect(container.querySelector('.appointments-table-scroll')!.getAttribute('tabindex')).toBe('0')
    expect(container.querySelectorAll('thead th[scope="col"]')).toHaveLength(5)
    expect(urls()).toEqual(['/api/vets', '/api/vets/7/appointments'])
    expect(container.querySelectorAll('button')).toSatisfy((buttons: NodeListOf<HTMLButtonElement>) => Array.from(buttons).every(button => !/cancel|confirm|edit|delete|reschedule|create/i.test(button.textContent ?? '')))
  })

  it('reads fresh details and pet name, focuses the inline section, and restores keyboard focus on Escape', async () => {
    responses['/api/appointments/42'] = { ...appointment, status: 'CONFIRMED' }
    await list()
    const button = container.querySelector<HTMLButtonElement>('[aria-label="View appointment 42"]')!
    button.focus()
    await act(async () => button.click())
    const detail = container.querySelector<HTMLElement>('#appointment-details')!
    expect(document.activeElement).toBe(detail)
    expect(detail.textContent).toContain('CONFIRMED')
    expect(detail.textContent).toContain('test-pet')
    expect(detail.textContent).toContain('Pet #3')
    expect(detail.textContent).toContain('Vet #7')
    expect(detail.querySelectorAll('time')).toHaveLength(2)
    expect(urls()).toEqual(['/api/vets', '/api/vets/7/appointments', '/api/appointments/42', '/api/pets/3'])
    await click('.appointment-copilot-action')
    expect(askAppointment).toHaveBeenCalledWith(42)
    await act(async () => detail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('#appointment-details')).toBeNull()
    expect(document.activeElement).toBe(button)
    await click('.appointments-agent-entry')
    expect(openAgent).toHaveBeenCalledOnce()
  })

  it('preserves directory HTTP failures and supports directory retry', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404))
    await render()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('HTTP 404')
    expect(container.querySelector('select')!.disabled).toBe(true)
    await click('.appointments-vet-picker button')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelectorAll('option')).toHaveLength(3)
    expect(urls()).toEqual(['/api/vets', '/api/vets'])
  })

  it('shows a successful empty directory without inventing a selection', async () => {
    responses['/api/vets'] = []
    await render()
    expect(container.textContent).toContain('No veterinarians returned.')
    expect(urls()).toEqual(['/api/vets'])
  })

  it('shows an empty appointment list only after a successful query', async () => {
    await render()
    await select('8')
    expect(container.textContent).toContain('No appointments returned for this veterinarian.')
    expect(container.querySelector('h2')!.textContent).toContain('Other Veterinarian · Vet #8 · 0 appointments returned')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it.each([401, 403, 404, 500, 503])('keeps HTTP %i as a list error rather than an empty array', async status => {
    fetchMock.mockResolvedValueOnce(json(vets)).mockResolvedValueOnce(json({}, status))
    await list()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(`HTTP ${status}`)
    expect(container.querySelector('h2')!.textContent).not.toContain('appointments returned')
    expect(container.textContent).not.toContain('No appointments returned')
    await click('.appointments-directory .appointments-query-error button')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('renders parsing failures as errors and can retry malformed JSON', async () => {
    fetchMock.mockResolvedValueOnce(json(vets)).mockResolvedValueOnce(new Response('broken JSON'))
    await list()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.querySelector('table')).toBeNull()
    await click('.appointments-directory .appointments-query-error button')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('keeps detail failures visible and retries a mismatched appointment ID', async () => {
    responses['/api/appointments/42'] = second
    await list()
    await click('[aria-label="View appointment 42"]')
    expect(container.querySelector('#appointment-details [role="alert"]')!.textContent).toContain('different appointment')
    expect(urls()).not.toContain('/api/pets/4')
    responses['/api/appointments/42'] = appointment
    await click('#appointment-details .appointments-query-error button')
    expect(container.querySelector('#appointment-details')!.textContent).toContain('test-pet')
  })

  it('keeps appointment details on pet lookup failure and retries only the pet query', async () => {
    await list()
    fetchMock.mockResolvedValueOnce(json(appointment)).mockResolvedValueOnce(json({}, 403))
    await click('[aria-label="View appointment 42"]')
    const detail = container.querySelector('#appointment-details')!
    expect(detail.textContent).toContain('Pet name unavailable.')
    expect(detail.textContent).toContain('HTTP 403')
    expect(detail.querySelectorAll('time')).toHaveLength(2)
    expect(detail.querySelector('.appointment-copilot-action')).not.toBeNull()
    await click('#appointment-details .appointments-query-error button')
    expect(detail.textContent).toContain('test-pet')
    expect(urls().filter(url => url === '/api/appointments/42')).toHaveLength(1)
    expect(urls().filter(url => url === '/api/pets/3')).toHaveLength(2)
  })

  it('aborts previous appointment details and ignores a late response', async () => {
    const old = deferred()
    await list()
    fetchMock.mockReturnValueOnce(old.promise)
    await click('[aria-label="View appointment 42"]')
    await click('[aria-label="View appointment 43"]')
    expect(signalAt(2).aborted).toBe(true)
    await act(async () => old.resolve(json(appointment)))
    expect(container.querySelector('#appointment-details')!.textContent).toContain('other-pet')
    expect(container.querySelector('#appointment-detail-heading')!.textContent).toBe('Appointment #43')
    expect(urls()).not.toContain('/api/pets/3')
  })

  it('aborts a previous veterinarian list and ignores a late list after switching or clearing selection', async () => {
    const old = deferred()
    await render()
    fetchMock.mockReturnValueOnce(old.promise)
    await select()
    await select('8')
    expect(signalAt(1).aborted).toBe(true)
    await act(async () => old.resolve(json([appointment])))
    expect(container.querySelector('h2')!.textContent).toContain('Vet #8 · 0 appointments returned')
    expect(container.querySelector('table')).toBeNull()
    await select('')
    expect(container.textContent).toContain('Select a veterinarian to view their appointments.')
  })

  it('aborts a previous pet lookup and does not attach its name to the new appointment', async () => {
    const old = deferred()
    await list()
    fetchMock.mockResolvedValueOnce(json(appointment)).mockReturnValueOnce(old.promise)
    await click('[aria-label="View appointment 42"]')
    await click('[aria-label="View appointment 43"]')
    expect(signalAt(3).aborted).toBe(true)
    await act(async () => old.resolve(json(pet)))
    expect(container.querySelector('#appointment-details')!.textContent).toContain('other-pet')
    expect(container.querySelector('#appointment-details')!.textContent).not.toContain('test-pet')
  })

  it.each(['directory', 'list', 'detail', 'pet'])('aborts pending %s queries when leaving the page', async stage => {
    const pending = deferred()
    if (stage === 'directory') { fetchMock.mockReturnValueOnce(pending.promise); await render() }
    else if (stage === 'list') { await render(); fetchMock.mockReturnValueOnce(pending.promise); await select() }
    else {
      await list()
      if (stage === 'pet') fetchMock.mockResolvedValueOnce(json(appointment))
      fetchMock.mockReturnValueOnce(pending.promise)
      await click('[aria-label="View appointment 42"]')
    }
    const obsolete = signalAt(fetchMock.mock.calls.length - 1)
    const calls = fetchMock.mock.calls.length
    await act(async () => root.render(<p>Other page</p>))
    expect(obsolete.aborted).toBe(true)
    await act(async () => pending.resolve(json(stage === 'directory' ? vets : stage === 'list' ? [appointment] : stage === 'detail' ? appointment : pet)))
    expect(container.textContent).toBe('Other page')
    expect(fetchMock).toHaveBeenCalledTimes(calls)
  })

  it('refresh closes details, cancels old requests, and reads the current veterinarian only', async () => {
    const old = deferred()
    await list()
    fetchMock.mockReturnValueOnce(old.promise)
    await click('[aria-label="View appointment 42"]')
    await click('.appointments-directory-heading button')
    expect(signalAt(2).aborted).toBe(true)
    await act(async () => old.resolve(json(appointment)))
    expect(container.querySelector('#appointment-details')).toBeNull()
    expect(urls()).toEqual(['/api/vets', '/api/vets/7/appointments', '/api/appointments/42', '/api/vets/7/appointments'])
  })

  it('clears a fresh detail that no longer belongs to the selected veterinarian and asks for refresh', async () => {
    responses['/api/appointments/42'] = { ...appointment, vetId: 8 }
    await list()
    await click('[aria-label="View appointment 42"]')
    expect(container.querySelector('#appointment-details')).toBeNull()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Refresh the list.')
    expect(urls()).not.toContain('/api/pets/3')
  })

  it('switching veterinarians closes details and a closed detail cannot return from a late request', async () => {
    const old = deferred()
    await list()
    fetchMock.mockReturnValueOnce(old.promise)
    await click('[aria-label="View appointment 42"]')
    await click('[aria-label="Close appointment details"]')
    expect(signalAt(2).aborted).toBe(true)
    expect(document.activeElement).toBe(container.querySelector('[aria-label="View appointment 42"]'))
    await act(async () => old.resolve(json(appointment)))
    expect(container.querySelector('#appointment-details')).toBeNull()
    await click('[aria-label="View appointment 42"]')
    await select('8')
    expect(container.querySelector('#appointment-details')).toBeNull()
    expect(container.textContent).not.toContain('test-pet')
  })

  it('integrates App navigation and prefills the existing Drawer without any Agent request', async () => {
    responses['/api/pets'] = [pet]
    await act(async () => root.render(<App />))
    await click('button[aria-label="Appointments"]')
    expect(container.querySelector('.appointments-scene')).not.toBeNull()
    expect(container.querySelector('.section-art-image img')!.getAttribute('src')).toBe('/clinic-editorial-v1.webp')
    await select()
    await click('[aria-label="View appointment 42"]')
    const entry = container.querySelector<HTMLButtonElement>('.appointment-copilot-action')!
    entry.focus()
    await act(async () => entry.click())
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Show appointment 42')
    expect(container.querySelector('.agent-drawer')!.getAttribute('aria-modal')).toBe('true')
    expect(container.querySelector('main')!.hasAttribute('inert')).toBe(true)
    expect(urls()).toEqual(['/api/vets', '/api/vets/7/appointments', '/api/appointments/42', '/api/pets/3'])
    expect(fetchMock.mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true)
    expect(localStorage.getItem('petclinic-agent-thread-id')).toBeNull()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(document.activeElement).toBe(entry)
    await click('button[aria-label="Pets"]')
    expect(container.querySelector('.pets-page')).not.toBeNull()
    await click('button[aria-label="Vets"]')
    expect(container.querySelector('.appointments-page')).toBeNull()
    expect(container.querySelector('.section-intro h1')!.textContent).toBe('Vets')
  })

  it('adapters reject malformed shapes, duplicate IDs, wrong veterinarian scopes and detail IDs', async () => {
    const signal = new AbortController().signal
    for (const value of [null, {}, [null], [vets[0], vets[0]], [{ ...vets[0], firstName: ' ' }]]) {
      fetchMock.mockResolvedValueOnce(json(value))
      await expect(listVets(signal)).rejects.toThrow()
    }
    for (const value of [null, {}, [null], [appointment, appointment], [{ ...appointment, vetId: 8 }]]) {
      fetchMock.mockResolvedValueOnce(json(value))
      await expect(listVetAppointments(7, signal)).rejects.toThrow()
    }
    fetchMock.mockResolvedValueOnce(json(second))
    await expect(getAppointment(42, signal)).rejects.toThrow('different appointment')
  })

  it('adapters reject unsafe fields, unknown statuses and normalized or timezone-free dates', async () => {
    const signal = new AbortController().signal
    const cases: [string, unknown][] = ['id', 'petId', 'vetId'].flatMap(field => [true, '42', 0, -1, 1.5, 2147483648].map(value => [field, value] as [string, unknown]))
    cases.push(...[true, '0', -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map(value => ['version', value] as [string, unknown]))
    cases.push(['status', 'UNKNOWN'], ['status', null])
    for (const field of ['startAt', 'createdAt']) {
      for (const value of [0, null, 'invalid', '2020-01-01T10:00:00', '2021-02-29T10:00:00Z', '2020-02-30T10:00:00Z', '2020-01-01T24:00:00Z', '2020-01-01T10:00:00+99:00']) cases.push([field, value])
    }
    for (const [field, value] of cases) {
      fetchMock.mockResolvedValueOnce(json({ ...appointment, [field]: value }))
      await expect(getAppointment(42, signal)).rejects.toThrow('invalid')
    }
    fetchMock.mockResolvedValueOnce(json({ ...appointment, id: undefined }))
    await expect(getAppointment(42, signal)).rejects.toThrow('invalid')
  })

  it('adapters refuse invalid outgoing IDs before fetching and accept safe historical UTC records', async () => {
    const signal = new AbortController().signal
    for (const id of [0, -1, 1.5, 2147483648]) {
      await expect(getAppointment(id, signal)).rejects.toThrow('ID is invalid')
      await expect(listVetAppointments(id, signal)).rejects.toThrow('ID is invalid')
    }
    expect(fetchMock).not.toHaveBeenCalled()
    for (const status of ['REQUESTED', 'CONFIRMED', 'CANCELLED', 'COMPLETED']) {
      const record = { ...appointment, startAt: '2000-02-29T10:00:00Z', status, version: Number.MAX_SAFE_INTEGER }
      fetchMock.mockResolvedValueOnce(json(record))
      expect(await getAppointment(42, signal)).toEqual(record)
    }
    expect(fetchMock.mock.calls.every(call => call[1]?.signal === signal && call[1]?.headers && (call[1].headers as Record<string, string>).Accept === 'application/json')).toBe(true)
  })
})
