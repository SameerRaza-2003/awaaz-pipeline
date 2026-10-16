from typing import Literal

from pydantic import BaseModel, Field

HARASSMENT_TYPES = ("workplace", "street/public", "online", "campus", "transport", "domestic", "other")


class LocationReport(BaseModel):
    location_available: bool
    lat: float | None = None
    lng: float | None = None
    accuracy_m: float | None = None
    address: str | None = None
    address_source: str | None = None
    maps_link: str | None = None
    captured_at: str | None = None
    note: str | None = Field(default=None, description="Typed location text from the user, if any")


class SmsOut(BaseModel):
    to: str
    sid: str | None = None
    status: str


class CallOut(BaseModel):
    to: str
    sid: str | None = None
    status: str


class AlertResult(BaseModel):
    sms: list[SmsOut] = Field(default_factory=list)
    call: CallOut | None = None


class IntakeRecord(BaseModel):
    incident_summary: str
    date_time: str | None = None
    city_area: str | None = None
    harassment_type: Literal["workplace", "street/public", "online", "campus", "transport", "domestic", "other"] = "other"
    accused: str | None = None
    witnesses: str | None = None
    evidence_available: str | None = None
    prior_reports: str | None = None
    institution_involved: str | None = None
    country: str = "PK"
    complainant_name: str | None = None
    complainant_contact: str | None = None
    complainant_address: str | None = None


class Drafts(BaseModel):
    police_text: str
    public_text: str
    public_clean: bool = False
    pii_findings: list[dict] = Field(default_factory=list)


class DraftingDone(BaseModel):
    """Final answer of the drafting agent once save_drafts succeeded (or attempts are exhausted)."""

    saved: bool
    notes: str = ""


class Recipient(BaseModel):
    community_id: int
    name: str
    email: str
    score: float
    reason: str


class Recipients(BaseModel):
    recipients: list[Recipient] = Field(default_factory=list)


class EmailOut(BaseModel):
    to: str
    status: str
    message_id: str | None = None


class EmailBatchResult(BaseModel):
    results: list[EmailOut] = Field(default_factory=list)


class DispatchOut(BaseModel):
    police_ref: str
    public_ref: str
    submitted_at: str


class StatusDecision(BaseModel):
    status: str
    addressed: bool
    escalated: bool
    reason: str
