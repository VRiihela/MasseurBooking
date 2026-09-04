import { useEffect, useState } from "react";
import "./AdminServices.css";
import {
  ApiError,
  createAdminService,
  getAdminServices,
  updateAdminService,
} from "../api/client";
import type { AdminService } from "../api/types";

interface Props {
  onSessionEnded: () => void;
}

interface ServiceFormState {
  name: string;
  price: string;
  duration_minutes: string;
  buffer_before_minutes: string;
  buffer_after_minutes: string;
  error: string | null;
}

interface ParsedServiceForm {
  name: string;
  price: number;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
}

function emptyServiceForm(): ServiceFormState {
  return {
    name: "",
    price: "",
    duration_minutes: "",
    buffer_before_minutes: "0",
    buffer_after_minutes: "0",
    error: null,
  };
}

function serviceToFormState(service: AdminService): ServiceFormState {
  return {
    name: service.name,
    price: String(service.price),
    duration_minutes: String(service.duration_minutes),
    buffer_before_minutes: String(service.buffer_before_minutes),
    buffer_after_minutes: String(service.buffer_after_minutes),
    error: null,
  };
}

// Mirrors createServiceSchema/updateServiceSchema exactly. Every field is
// coerced from the input's string value to a real number here -- z.number()
// on the backend rejects a raw string outright, so this can't be skipped.
function validateServiceForm(form: ServiceFormState): ParsedServiceForm | { error: string } {
  const name = form.name.trim();
  if (!name) {
    return { error: "Nimi on pakollinen." };
  }

  const price = Number(form.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { error: "Hinnan on oltava positiivinen luku." };
  }

  const duration_minutes = Number(form.duration_minutes);
  if (!Number.isInteger(duration_minutes) || duration_minutes <= 0) {
    return { error: "Hieronnan keston on oltava positiivinen kokonaisluku minuutteina." };
  }

  const buffer_before_minutes = Number(form.buffer_before_minutes);
  if (!Number.isInteger(buffer_before_minutes) || buffer_before_minutes < 0) {
    return { error: "Puskurin ennen on oltava nolla tai positiivinen kokonaisluku minuutteina." };
  }

  const buffer_after_minutes = Number(form.buffer_after_minutes);
  if (!Number.isInteger(buffer_after_minutes) || buffer_after_minutes < 0) {
    return { error: "Puskurin jälkeen on oltava nolla tai positiivinen kokonaisluku minuutteina." };
  }

  return { name, price, duration_minutes, buffer_before_minutes, buffer_after_minutes };
}

function ServiceFormFields({
  form,
  onChange,
}: {
  form: ServiceFormState;
  onChange: (patch: Partial<ServiceFormState>) => void;
}) {
  return (
    <>
      <label>
        Nimi
        <input type="text" value={form.name} onChange={(event) => onChange({ name: event.target.value })} />
      </label>
      <label>
        Hinta
        <input
          type="number"
          step="0.01"
          value={form.price}
          onChange={(event) => onChange({ price: event.target.value })}
        />
      </label>
      <label>
        Hieronnan kesto (minuuttia)
        <input
          type="number"
          step="1"
          value={form.duration_minutes}
          onChange={(event) => onChange({ duration_minutes: event.target.value })}
        />
      </label>
      <label>
        Puskuri ennen (minuuttia) -- valmisteluaika juuri ennen hierontaa, ei varattavissa
        <input
          type="number"
          step="1"
          value={form.buffer_before_minutes}
          onChange={(event) => onChange({ buffer_before_minutes: event.target.value })}
        />
      </label>
      <label>
        Puskuri jälkeen (minuuttia) -- siivousaika juuri hieronnan jälkeen, ei varattavissa
        <input
          type="number"
          step="1"
          value={form.buffer_after_minutes}
          onChange={(event) => onChange({ buffer_after_minutes: event.target.value })}
        />
      </label>
    </>
  );
}

export function AdminServices({ onSessionEnded }: Props) {
  const [services, setServices] = useState<AdminService[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<ServiceFormState>(emptyServiceForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ServiceFormState>(emptyServiceForm);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setServices(null);

    getAdminServices()
      .then((result) => {
        if (!cancelled) {
          setServices(result);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          onSessionEnded();
          return;
        }
        setLoadError("Palveluita ei voitu ladata. Yritä hetken kuluttua uudelleen.");
      });

    return () => {
      cancelled = true;
    };
  }, [onSessionEnded]);

  async function handleCreate() {
    const parsed = validateServiceForm(createForm);
    if ("error" in parsed) {
      setCreateForm((current) => ({ ...current, error: parsed.error }));
      return;
    }
    setCreateForm((current) => ({ ...current, error: null }));

    try {
      const service = await createAdminService(parsed);
      setServices((current) => (current ? [...current, service] : [service]));
      setCreateForm(emptyServiceForm());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnded();
        return;
      }
      const message =
        error instanceof ApiError ? error.message : "Palvelua ei voitu luoda. Yritä uudelleen.";
      setCreateForm((current) => ({ ...current, error: message }));
    }
  }

  function startEdit(service: AdminService) {
    setEditingId(service.id);
    setEditForm(serviceToFormState(service));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyServiceForm());
  }

  async function handleSaveEdit(id: string) {
    const parsed = validateServiceForm(editForm);
    if ("error" in parsed) {
      setEditForm((current) => ({ ...current, error: parsed.error }));
      return;
    }
    setEditForm((current) => ({ ...current, error: null }));

    try {
      const updated = await updateAdminService(id, parsed);
      setServices((current) => current?.map((service) => (service.id === id ? updated : service)) ?? current);
      setEditingId(null);
      setEditForm(emptyServiceForm());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnded();
        return;
      }
      const message = error instanceof ApiError ? error.message : "Muutoksia ei voitu tallentaa. Yritä uudelleen.";
      setEditForm((current) => ({ ...current, error: message }));
    }
  }

  async function handleToggleActive(service: AdminService) {
    setToggleError(null);
    try {
      const updated = await updateAdminService(service.id, { active: !service.active });
      setServices((current) => current?.map((item) => (item.id === service.id ? updated : item)) ?? current);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnded();
        return;
      }
      setToggleError(
        error instanceof ApiError ? error.message : "Palvelua ei voitu päivittää. Yritä uudelleen.",
      );
    }
  }

  return (
    <div className="admin-services">
      {loadError && <p role="alert">{loadError}</p>}
      {toggleError && <p role="alert">{toggleError}</p>}
      {!loadError && services === null && <p>Ladataan palveluita&hellip;</p>}

      {services !== null && (
        <ul>
          {services.map((service) => (
            <li
              key={service.id}
              data-testid={`service-${service.id}`}
              className={service.active ? undefined : "admin-service-inactive"}
            >
              {editingId === service.id ? (
                <>
                  <ServiceFormFields
                    form={editForm}
                    onChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
                  />
                  {editForm.error && <p role="alert">{editForm.error}</p>}
                  <button type="button" className="btn btn-primary" onClick={() => void handleSaveEdit(service.id)}>
                    Tallenna
                  </button>
                  <button type="button" className="btn btn-back" onClick={cancelEdit}>
                    Peruuta
                  </button>
                </>
              ) : (
                <>
                  <p>
                    {service.name} {!service.active && "(ei käytössä)"}
                  </p>
                  <p>Hinta: {service.price}</p>
                  <p>Hieronnan kesto: {service.duration_minutes} minuuttia</p>
                  <p>Puskuri ennen: {service.buffer_before_minutes} minuuttia</p>
                  <p>Puskuri jälkeen: {service.buffer_after_minutes} minuuttia</p>
                  <button type="button" className="btn btn-secondary" onClick={() => startEdit(service)}>
                    Muokkaa
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => void handleToggleActive(service)}>
                    {service.active ? "Poista käytöstä" : "Aktivoi"}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <section aria-label="Lisää uusi palvelu">
        <h2>Lisää uusi palvelu</h2>
        <ServiceFormFields
          form={createForm}
          onChange={(patch) => setCreateForm((current) => ({ ...current, ...patch }))}
        />
        {createForm.error && <p role="alert">{createForm.error}</p>}
        <button type="button" className="btn btn-primary" onClick={() => void handleCreate()}>
          Lisää palvelu
        </button>
      </section>
    </div>
  );
}
