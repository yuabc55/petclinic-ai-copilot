import { useEffect, useRef, useState } from 'react'
import { getOwner, getPet, listPets, type OwnerSummary, type PetRecord } from './petApi'

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Pet records are unavailable. Please try again.'
}

export function PetsPage({ onOpenAgent, onAskPet }: { onOpenAgent: () => void; onAskPet: (id: number) => void }) {
  const [pets, setPets] = useState<PetRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [listVersion, setListVersion] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [pet, setPet] = useState<PetRecord | null>(null)
  const [owner, setOwner] = useState<OwnerSummary | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [ownerError, setOwnerError] = useState<string | null>(null)
  const [detailVersion, setDetailVersion] = useState(0)
  const detailRef = useRef<HTMLElement>(null)
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    listPets(controller.signal).then(rows => {
      if (!controller.signal.aborted) setPets(rows)
    }).catch(cause => {
      if (!controller.signal.aborted) setError(errorText(cause))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [listVersion])

  useEffect(() => {
    if (selectedId === null) return
    const controller = new AbortController()
    setPet(null)
    setOwner(null)
    setDetailError(null)
    setOwnerError(null)
    setDetailLoading(true)
    detailRef.current?.focus()
    async function load() {
      try {
        const record = await getPet(selectedId!, controller.signal)
        if (controller.signal.aborted) return
        setPet(record)
        try {
          const summary = await getOwner(record.ownerId, controller.signal)
          if (!controller.signal.aborted) setOwner(summary)
        } catch (cause) {
          if (!controller.signal.aborted) setOwnerError(errorText(cause))
        }
      } catch (cause) {
        if (!controller.signal.aborted) setDetailError(errorText(cause))
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [selectedId, detailVersion])

  function closeDetails() {
    setSelectedId(null)
    selectedButtonRef.current?.focus({ preventScroll: true })
  }

  return <section className="pets-page" aria-labelledby="pets-heading">
    <header className="pets-heading">
      <div><span className="section-kicker">PET RECORDS</span><h1 id="pets-heading">Pets</h1><p>Browse clinic records and select a pet for details.</p></div>
      <button className="pets-agent-entry" onClick={onOpenAgent}>Ask Dr. Cleo</button>
    </header>
    <div className={`pets-workspace${selectedId !== null ? ' has-details' : ''}`}>
      <section className="pets-directory" aria-label="Pet directory" aria-busy={loading}>
        <div className="pets-directory-heading"><h2>Pet directory{!loading && !error && <span> · {pets.length}</span>}</h2><button disabled={loading} onClick={() => { closeDetails(); setListVersion(value => value + 1) }}>Refresh</button></div>
        {loading ? <p role="status">Loading pet records…</p> : error ? <div className="pets-query-error" role="alert"><p>{error}</p><button onClick={() => setListVersion(value => value + 1)}>Retry pet list</button></div> : pets.length === 0 ? <p role="status">No pet records returned.</p> :
          <div className="pets-table-scroll" role="region" aria-label="Pet list table" tabIndex={0}>
            <table><caption className="sr-only">Pet IDs, names, types, birth dates and owner IDs</caption><thead><tr><th scope="col">Pet</th><th scope="col">Type</th><th scope="col">Birth date</th><th scope="col">Owner</th></tr></thead>
              <tbody>{pets.map(record => <tr key={record.id} className={selectedId === record.id ? 'is-selected' : undefined}><th scope="row"><button aria-label={`View ${record.name}, pet ${record.id}`} aria-expanded={selectedId === record.id} aria-controls={selectedId === record.id ? 'pet-details' : undefined} onClick={event => { selectedButtonRef.current = event.currentTarget; setSelectedId(record.id) }}><strong>{record.name}</strong><span>Pet #{record.id}</span></button></th><td>{record.type.name}</td><td><time dateTime={record.birthDate}>{record.birthDate}</time></td><td>Owner #{record.ownerId}</td></tr>)}</tbody>
            </table>
          </div>}
      </section>
      {selectedId !== null && <section id="pet-details" className="pet-details" ref={detailRef} tabIndex={-1} aria-labelledby="pet-detail-heading" aria-busy={detailLoading} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeDetails() } }}>
        <div className="pet-details-heading"><h2 id="pet-detail-heading">{pet ? pet.name : `Pet #${selectedId}`}</h2><button onClick={closeDetails} aria-label="Close pet details">Close</button></div>
        {detailLoading && <p role="status">Loading pet details…</p>}
        {detailError && <div role="alert" className="pets-query-error"><p>{detailError}</p><button onClick={() => setDetailVersion(value => value + 1)}>Retry pet details</button></div>}
        {pet && <><dl><div><dt>Pet ID</dt><dd>#{pet.id}</dd></div><div><dt>Type</dt><dd>{pet.type.name}</dd></div><div><dt>Birth date</dt><dd><time dateTime={pet.birthDate}>{pet.birthDate}</time></dd></div><div><dt>Owner</dt><dd>{owner && `${owner.firstName} ${owner.lastName}`.trim()}<span>Owner #{pet.ownerId}</span></dd></div></dl>
          {ownerError && <div className="pets-query-error" role="alert"><p>Owner name unavailable. {ownerError}</p><button onClick={() => setDetailVersion(value => value + 1)}>Retry owner details</button></div>}
          <button className="pet-copilot-action" onClick={() => onAskPet(pet.id)}>Ask Dr. Cleo about {pet.name}</button></>}
      </section>}
    </div>
  </section>
}
