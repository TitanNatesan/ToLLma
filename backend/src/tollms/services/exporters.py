"""Export engines: conversation Markdown/JSON/PDF and analytics XLSX.

Pure rendering functions — no DB access, no HTTP. Feature services assemble
the data and stream the bytes back.
"""

import io
import json
import logging
from datetime import datetime, timezone
from decimal import Decimal

from fpdf import FPDF
from openpyxl import Workbook
from openpyxl.styles import Font

from tollms.models.conversation import Conversation
from tollms.models.message import Message

logger = logging.getLogger(__name__)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _number(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def conversation_markdown(
    conversation: Conversation,
    messages: list[Message],
    *,
    provider_name: str | None = None,
    model_name: str | None = None,
) -> str:
    """`# Title` then `## User` / `## Assistant` sections with usage footers."""
    lines = [f"# {conversation.title}", ""]
    lines.append(f"- Exported: {datetime.now(timezone.utc).isoformat()}")
    if provider_name or model_name:
        lines.append(f"- Model: {' / '.join(filter(None, [provider_name, model_name]))}")
    lines.append("")
    for message in messages:
        role = message.role.value if hasattr(message.role, "value") else str(message.role)
        heading = {"user": "User", "assistant": "Assistant", "system": "System"}.get(role, role.title())
        lines.append(f"## {heading}")
        lines.append("")
        lines.append(message.content or "")
        lines.append("")
        usage = []
        if message.total_tokens:
            usage.append(f"{message.total_tokens} tokens")
        if message.total_cost:
            usage.append(f"${message.total_cost}")
        if message.latency_ms:
            usage.append(f"{round(message.latency_ms)}ms")
        if usage:
            lines.append(f"*{' · '.join(usage)}*")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def conversation_payload(
    conversation: Conversation,
    messages: list[Message],
    *,
    provider_name: str | None = None,
    model_name: str | None = None,
) -> dict:
    """Structured export: messages, model, provider, timestamps, usage, cost."""
    return {
        "id": str(conversation.id),
        "title": conversation.title,
        "created_at": _iso(conversation.created_at),
        "updated_at": _iso(conversation.updated_at),
        "provider": {"id": str(conversation.provider_id) if conversation.provider_id else None,
                     "name": provider_name},
        "model": {"id": str(conversation.model_id) if conversation.model_id else None,
                  "name": model_name},
        "branch": {
            "parent_conversation_id": str(conversation.parent_conversation_id)
            if conversation.parent_conversation_id else None,
            "branch_from_message_id": str(conversation.branch_from_message_id)
            if conversation.branch_from_message_id else None,
            "branch_name": conversation.branch_name,
        },
        "messages": [
            {
                "id": str(message.id),
                "role": message.role.value if hasattr(message.role, "value") else str(message.role),
                "content": message.content,
                "status": message.status.value if hasattr(message.status, "value") else str(message.status),
                "created_at": _iso(message.created_at),
                "model_id": str(message.model_id) if message.model_id else None,
                "provider_id": str(message.provider_id) if message.provider_id else None,
                "usage": {
                    "prompt_tokens": message.prompt_tokens,
                    "completion_tokens": message.completion_tokens,
                    "total_tokens": message.total_tokens,
                    "reasoning_tokens": message.reasoning_tokens,
                },
                "cost": {
                    "input": _number(message.input_cost),
                    "output": _number(message.output_cost),
                    "total": _number(message.total_cost),
                },
                "latency_ms": message.latency_ms,
                "thinking_ms": message.thinking_ms,
            }
            for message in messages
        ],
        "usage_summary": {
            "messages": len(messages),
            "total_tokens": sum(m.total_tokens or 0 for m in messages),
            "total_cost": sum(float(m.total_cost or 0) for m in messages),
        },
    }


def _latin(text: str) -> str:
    """fpdf2 core fonts are latin-1; degrade gracefully instead of raising."""
    return (text or "").encode("latin-1", "replace").decode("latin-1")


class _ConversationPDF(FPDF):
    def header(self) -> None:  # noqa: D102 - fpdf hook
        self.set_font("helvetica", "B", 9)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, _latin("ToLLma conversation export"), align="R")
        self.ln(10)

    def footer(self) -> None:  # noqa: D102 - fpdf hook
        self.set_y(-12)
        self.set_font("helvetica", "", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 8, f"{self.page_no()}", align="C")


def conversation_pdf(
    conversations: list[tuple[Conversation, list[Message], str | None, str | None]],
) -> bytes:
    """Professional layout: title block, metadata, usage summary, messages."""
    pdf = _ConversationPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(16, 16, 16)

    for conversation, messages, provider_name, model_name in conversations:
        pdf.add_page()
        pdf.set_font("helvetica", "B", 18)
        pdf.set_text_color(20, 20, 20)
        pdf.multi_cell(0, 9, _latin(conversation.title))
        pdf.ln(1)

        pdf.set_font("helvetica", "", 9)
        pdf.set_text_color(110, 110, 110)
        meta = [f"Created {_iso(conversation.created_at) or 'unknown'}"]
        if provider_name or model_name:
            meta.append("Model " + " / ".join(filter(None, [provider_name, model_name])))
        meta.append(f"{len(messages)} messages")
        total_tokens = sum(m.total_tokens or 0 for m in messages)
        total_cost = sum(float(m.total_cost or 0) for m in messages)
        meta.append(f"{total_tokens} tokens")
        meta.append(f"${total_cost:.6f}")
        pdf.multi_cell(0, 5, _latin(" · ".join(meta)))
        pdf.ln(4)

        for message in messages:
            role = message.role.value if hasattr(message.role, "value") else str(message.role)
            heading = {"user": "User", "assistant": "Assistant", "system": "System"}.get(role, role.title())
            pdf.set_font("helvetica", "B", 11)
            pdf.set_text_color(60, 60, 60)
            pdf.cell(0, 7, _latin(heading), new_x="LMARGIN", new_y="NEXT")
            pdf.set_font("helvetica", "", 10)
            pdf.set_text_color(25, 25, 25)
            pdf.multi_cell(0, 5.2, _latin(message.content or ""))
            footer = []
            if message.total_tokens:
                footer.append(f"{message.total_tokens} tokens")
            if message.total_cost:
                footer.append(f"${message.total_cost}")
            if footer:
                pdf.set_font("helvetica", "I", 8)
                pdf.set_text_color(130, 130, 130)
                pdf.cell(0, 5, _latin(" · ".join(footer)), new_x="LMARGIN", new_y="NEXT")
            pdf.ln(2)

    output = pdf.output()
    return bytes(output)


def analytics_xlsx(sheets: list[tuple[str, list[str], list[list[object]]]]) -> bytes:
    """One workbook, one styled sheet per analytics dataset."""
    workbook = Workbook()
    default = workbook.active
    if default is not None:
        workbook.remove(default)

    for title, headers, rows in sheets:
        sheet = workbook.create_sheet(title=title[:31] or "Sheet")
        sheet.append(headers)
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        for row in rows:
            sheet.append([_cell_value(value) for value in row])
        for column_cells in sheet.columns:
            width = max((len(str(cell.value or "")) for cell in column_cells), default=8)
            sheet.column_dimensions[column_cells[0].column_letter].width = min(max(width + 2, 10), 48)

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _cell_value(value: object) -> object:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if value is None:
        return ""
    return value


def dump_json(payload: object) -> bytes:
    return json.dumps(payload, indent=2, ensure_ascii=False, default=str).encode("utf-8")
