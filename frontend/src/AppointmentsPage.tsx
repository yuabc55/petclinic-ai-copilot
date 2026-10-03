import { useEffect, useRef, useState } from 'react'
import { getAppointment, listVetAppointments, listVets, type AppointmentRecord, type VetSummary } from './appointmentApi'
import { getPet, type PetRecord } from './petApi'

type QueryState = 'idle' | 'loading' | 'success' | 'error'
const utcFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
function Time({ value }: { value: string }) {
  return <time dateTime={value}>{utcFormat.format(new Date(value))} UTC</time>
}
function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Clinic records are unavailable. Please try again.'
}

export function AppointmentsPage({ onOpenAgent, onAskAppointment }: { onOpenAgent: () => void; onAskAppointment: (id: number) => void }) {
  const [vets, setVets] = useState<VetSummary[]>([])
  const [vetsState, setVetsState] = useState<QueryState>('loading')
  const [vetsError, setVetsError] = useState<string | null>(null)
  const [vetsVersion, setVetsVersion] = useState(0)
  const [vetId, setVetId] = useState<number | null>(null)
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([])
  const [listState, setListState] = useState<QueryState>('idle')
  const [listError, setListError] = useState<string | null>(null)
  const [listVersion, setListVersion] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [appointment, setAppointment] = useState<AppointmentRecord | null>(null)
  const [detailState, setDetailState] = useState<QueryState>('idle')
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailVersion, setDetailVersion] = useState(0)
  const [pet, setPet] = useState<PetRecord | null>(null)
  const [petState, setPetState] = useState<QueryState>('idle')
  const [petError, setPetError] = useState<string | null>(null)
  const [petVersion, setPetVersion] = useState(0)
  const detailRef = useRef<HTMLElement>(null)
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null)
  const listController = useRef<AbortController | null>(null)
  const detailController = useRef<AbortController | null>(null)
  const petController = useRef<AbortController | null>(null)

  function vetLabel(id: number) {
    const vet = vets.find(record => record.id === id)
    return vet ? `${vet.firstName} ${vet.lastName} · Vet #${id}` : `Vet #${id} · Name unavailable`
  }

  useEffect(() => {
    const controller = new AbortController()
    setVetsState('loading')
    setVetsError(null)
    listVets(controller.signal).then(records => {
      if (controller.signal.aborted) return
      setVets(records)
      setVetsState('success')
    }).catch(cause => {
      if (controller.signal.aborted) return
      setVetsError(errorText(cause))
      setVetsState('error')
    })
    return () => controller.abort()
  }, [vetsVersion])

  useEffect(() => {
    if (vetId === null) return
    const controller = new AbortController()
    listController.current = controller
    setListState('loading')
    setListError(null)
    listVetAppointments(vetId, controller.signal).then(records => {
      if (controller.signal.aborted) return
      setAppointments(records)
      setListState('success')
    }).catch(cause => {
      if (controller.signal.aborted) return
      setListError(errorText(cause))
      setListState('error')
    })
    return () => controller.abort()
  }, [vetId, listVersion])

  useEffect(() => {
    if (selectedId === null || vetId === null) return
    const controller = new AbortController()
    detailController.current = controller
    setDetailState('loading')
    setDetailError(null)
    detailRef.current?.focus()
    getAppointment(selectedId, controller.signal).then(record => {
      if (controller.signal.aborted) return
      if (record.vetId !== vetId) {
        setSelectedId(null)
        setListError('This appointment no longer belongs to the selected veterinarian. Refresh the list.')
        selectedButtonRef.current?.focus({ preventScroll: true })
        return
      }
      setAppointment(record)
      setDetailState('success')
    }).catch(cause => {
      if (controller.signal.aborted) return
      setDetailError(errorText(cause))
      setDetailState('error')
    })
    return () => controller.abort()
  }, [selectedId, vetId, detailVersion])

  useEffect(() => {
    if (!appointment) return
    const controller = new AbortController()
    petController.current = controller
    setPetState('loading')
    setPetError(null)
    getPet(appointment.petId, controller.signal).then(record => {
      if (controller.signal.aborted) return
      setPet(record)
      setPetState('success')
    }).catch(cause => {
      if (controller.signal.aborted) return
      setPetError(errorText(cause))
      setPetState('error')
    })
    return () => controller.abort()
  }, [appointment, petVersion])

  function clearDetails() {
    detailController.current?.abort()
    petController.current?.abort()
    setSelectedId(null)
    setAppointment(null)
    setPet(null)
    setDetailError(null)
    setPetError(null)
    setDetailState('idle')
    setPetState('idle')
  }
  function closeDetails() {
    clearDetails()
    selectedButtonRef.current?.focus({ preventScroll: true })
  }
  function refreshList() {
    listController.current?.abort()
    clearDetails()
    setAppointments([])
    setListError(null)
    setListVersion(value => value + 1)
  }

  return <section className="appointments-page" aria-labelledby="appointments-heading">
    <header className="appointments-heading">
      <div><span className="section-kicker">CLINIC APPOINTMENTS</span><h1 id="appointments-heading">Appointments</h1><p>Read-only appointment records, grouped by veterinarian. All times are UTC.</p></div>
      <button className="appointments-agent-entry" onClick={onOpenAgent}>Ask Dr. Cleo</button>
    </header>
    <div className="appointments-vet-picker" aria-busy={vetsState === 'loading'}>
      <label htmlFor="appointment-vet">Veterinarian</label>
      <select id="appointment-vet" value={vetId ?? ''} disabled={vetsState !== 'success'} onChange={event => {
        listController.current?.abort()
        clearDetails()
        setAppointments([])
        setListError(null)
        setListState(event.target.value ? 'loading' : 'idle')
        setVetId(event.target.value ? Number(event.target.value) : null)
      }}><option value="">Select a veterinarian</option>{vets.map(vet => <option key={vet.id} value={vet.id}>{vetLabel(vet.id)}</option>)}</select>
      {vetsState === 'loading' && <p role="status">Loading veterinarians…</p>}
      {vetsState === 'error' && <div className="appointments-query-error" role="alert"><p>{vetsError}</p><button onClick={() => setVetsVersion(value => value + 1)}>Retry veterinarians</button></div>}
      {vetsState === 'success' && vets.length === 0 && <p role="status">No veterinarians returned.</p>}
    </div>
    <div className={`appointments-workspace${selectedId !== null ? ' has-details' : ''}`}>
      <section className="appointments-directory" aria-label="Appointment directory" aria-busy={listState === 'loading'}>
        <div className="appointments-directory-heading"><h2>{vetId === null ? 'Appointment directory' : vetLabel(vetId)}{listState === 'success' && <span> · {appointments.length} appointments returned</span>}</h2><button disabled={vetId === null || listState === 'loading'} onClick={refreshList}>Refresh</button></div>
        {listError && <div className="appointments-query-error" role="alert"><p>{listError}</p><button onClick={refreshList}>Retry appointment list</button></div>}
        {vetId === null ? <p role="status">Select a veterinarian to view their appointments.</p> : listState === 'loading' ? <p role="status">Loading appointments…</p> : listState === 'success' && (appointments.length === 0 ? <p role="status">No appointments returned for this veterinarian.</p> :
          <div className="appointments-table-scroll" role="region" aria-label="Appointment list table" tabIndex={0}>
            <table><caption className="sr-only">Appointment IDs, start times in UTC, statuses, pet IDs and veterinarians</caption><thead><tr><th scope="col">Appointment</th><th scope="col">Start time (UTC)</th><th scope="col">Status</th><th scope="col">Pet</th><th scope="col">Veterinarian</th></tr></thead>
              <tbody>{appointments.map(record => <tr key={record.id} className={selectedId === record.id ? 'is-selected' : undefined}><th scope="row"><button aria-label={`View appointment ${record.id}`} aria-expanded={selectedId === record.id} aria-controls={selectedId === record.id ? 'appointment-details' : undefined} onClick={event => {
                clearDetails()
                selectedButtonRef.current = event.currentTarget
                setSelectedId(record.id)
                setDetailVersion(value => value + 1)
              }}>Appointment #{record.id}</button></th><td><Time value={record.startAt} /></td><td><span className="appointment-status">{record.status}</span></td><td>Pet #{record.petId}</td><td>{vetLabel(record.vetId)}</td></tr>)}</tbody>
            </table>
          </div>)}
      </section>
      {selectedId !== null && <section id="appointment-details" className="appointment-details" ref={detailRef} tabIndex={-1} aria-labelledby="appointment-detail-heading" aria-busy={detailState === 'loading'} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeDetails() } }}>
        <div className="appointment-details-heading"><h2 id="appointment-detail-heading">Appointment #{selectedId}</h2><button onClick={closeDetails} aria-label="Close appointment details">Close</button></div>
        {detailState === 'loading' && <p role="status">Loading appointment details…</p>}
        {detailError && <div className="appointments-query-error" role="alert"><p>{detailError}</p><button onClick={() => setDetailVersion(value => value + 1)}>Retry appointment details</button></div>}
        {appointment && <><dl><div><dt>Appointment ID</dt><dd>#{appointment.id}</dd></div><div><dt>Status</dt><dd><span className="appointment-status">{appointment.status}</span></dd></div><div><dt>Start time (UTC)</dt><dd><Time value={appointment.startAt} /></dd></div><div><dt>Created time (UTC)</dt><dd><Time value={appointment.createdAt} /></dd></div><div><dt>Pet</dt><dd>{pet?.name}<span>Pet #{appointment.petId}</span></dd></div><div><dt>Veterinarian</dt><dd>{vetLabel(appointment.vetId)}</dd></div></dl>
          {petState === 'loading' && <p role="status">Loading pet name…</p>}
          {petError && <div className="appointments-query-error" role="alert"><p>Pet name unavailable. {petError}</p><button onClick={() => setPetVersion(value => value + 1)}>Retry pet name</button></div>}
          <button className="appointment-copilot-action" onClick={() => onAskAppointment(appointment.id)}>Ask Dr. Cleo about appointment #{appointment.id}</button></>}
      </section>}
    </div>
  </section>
}
