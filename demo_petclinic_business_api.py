"""Read-only business API forwarding to the existing Java PetClinic service."""

from datetime import date

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, Field, ValidationError

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
