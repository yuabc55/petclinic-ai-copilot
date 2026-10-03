"""Read-only business API forwarding to the existing Java PetClinic service."""

from datetime import date
import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Path
from pydantic import AwareDatetime, BaseModel, Field, ValidationError, field_validator

from demo_petclinic_cancel_agent import request_json


router = APIRouter(prefix="/api", tags=["Pet records"])


class PetType(BaseModel):
    id: int = Field(strict=True, gt=0)
    name: str = Field(min_length=1)


class PetRecord(BaseModel):
    id: int = Field(strict=True, gt=0)
    name: str = Field(min_length=1)
    birthDate: date
    type: PetType
    ownerId: int = Field(strict=True, gt=0)


class OwnerSummary(BaseModel):
    id: int = Field(strict=True, gt=0)
    firstName: str
    lastName: str


def read_record(path: str, model: type[BaseModel], *, many: bool = False):
    result = request_json("GET", path, allow_list=True) if many else request_json("GET", path)
    if not result.get("ok"):
        status = result.get("status")
        if type(status) is int and 400 <= status <= 599:
            raise HTTPException(status, "PetClinic could not complete this query.")
        raise HTTPException(502, "PetClinic is unavailable or returned an invalid response.")
    data = result.get("data")
    if not isinstance(data, list if many else dict):
        raise HTTPException(502, "PetClinic returned an invalid response.")
    try:
        return [model.model_validate(row) for row in data] if many else model.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(502, "PetClinic returned an invalid record.") from exc


@router.get("/pets", response_model=list[PetRecord])
def pets():
    return read_record("/pets", PetRecord, many=True)


@router.get("/pets/{pet_id}", response_model=PetRecord)
def pet(pet_id: int = Path(gt=0, le=2147483647)):
    record = read_record(f"/pets/{pet_id}", PetRecord)
    if record.id != pet_id:
        raise HTTPException(502, "PetClinic returned a different pet.")
    return record


@router.get("/owners/{owner_id}", response_model=OwnerSummary)
def owner(owner_id: int = Path(gt=0, le=2147483647)):
    record = read_record(f"/owners/{owner_id}", OwnerSummary)
    if record.id != owner_id:
        raise HTTPException(502, "PetClinic returned a different owner.")
    return record


class VetSummary(BaseModel):
    id: int = Field(strict=True, gt=0, le=2147483647)
    firstName: str = Field(strict=True, min_length=1)
    lastName: str = Field(strict=True, min_length=1)

    @field_validator("firstName", "lastName")
    @classmethod
    def nonblank_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name must not be blank")
        return value


class AppointmentRecord(BaseModel):
    id: int = Field(strict=True, gt=0, le=2147483647)
    petId: int = Field(strict=True, gt=0, le=2147483647)
    vetId: int = Field(strict=True, gt=0, le=2147483647)
    startAt: AwareDatetime
    status: Literal["REQUESTED", "CONFIRMED", "CANCELLED", "COMPLETED"]
    createdAt: AwareDatetime
    version: int = Field(strict=True, ge=0, le=9223372036854775807)

    @field_validator("startAt", "createdAt", mode="before")
    @classmethod
    def string_datetime(cls, value):
        if not isinstance(value, str) or not re.fullmatch(
                r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value):
            raise ValueError("Date-time must be a string with a timezone")
        return value


def read_unique_records(path: str, model: type[BaseModel]):
    records = read_record(path, model, many=True)
    if len({record.id for record in records}) != len(records):
        raise HTTPException(502, "PetClinic returned an invalid record.")
    return records


@router.get("/vets", response_model=list[VetSummary])
def vets():
    return read_unique_records("/vets", VetSummary)


@router.get("/vets/{vet_id}/appointments", response_model=list[AppointmentRecord])
def vet_appointments(vet_id: int = Path(gt=0, le=2147483647)):
    records = read_unique_records(f"/vets/{vet_id}/appointments", AppointmentRecord)
    if any(record.vetId != vet_id for record in records):
        raise HTTPException(502, "PetClinic returned an invalid record.")
    return records


@router.get("/appointments/{appointment_id}", response_model=AppointmentRecord)
def appointment(appointment_id: int = Path(gt=0, le=2147483647)):
    record = read_record(f"/appointments/{appointment_id}", AppointmentRecord)
    if record.id != appointment_id:
        raise HTTPException(502, "PetClinic returned an invalid record.")
    return record
