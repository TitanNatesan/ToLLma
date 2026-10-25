"""ORM entities. Importing this package registers every table on Base.metadata."""

from tollms.models.api_key import (  # noqa: F401
    ApiKey,
    ApiKeyIpRule,
    ApiKeyModelPermission,
    ApiKeyPolicy,
    ApiRequestLog,
    IpRuleType,
)
from tollms.models.attachment import Attachment  # noqa: F401
from tollms.models.conversation import Conversation  # noqa: F401
from tollms.models.message import Message, Role  # noqa: F401
from tollms.models.message_history import GenerationRun, MessageVersion  # noqa: F401
from tollms.models.canonical_model import CanonicalModel  # noqa: F401
from tollms.models.model_repository import RepositoryModel, RepositorySource, SyncRun  # noqa: F401
from tollms.models.organization import (  # noqa: F401
    AuditLog,
    Invitation,
    InvitationKind,
    InvitationStatus,
    Membership,
    MembershipPermissionSet,
    MembershipState,
    Notification,
    Organization,
    OrgStatus,
    PermissionSet,
    PermissionSetPermission,
    Team,
    TeamMembership,
    TeamPermissionSet,
)
from tollms.models.password_reset import PasswordResetToken  # noqa: F401
from tollms.models.provider import Provider, ProviderType  # noqa: F401
from tollms.models.provider_catalog import ProviderCatalog  # noqa: F401
from tollms.models.purge_audit import PurgeAuditLog  # noqa: F401
from tollms.models.registered_model import AIModel, EndpointType  # noqa: F401
from tollms.models.guardrail import (  # noqa: F401
    Action,
    Category,
    DeliveryMode,
    Enforcement,
    EvaluatorType,
    GuardrailAssignment,
    GuardrailEvaluatorConfig,
    GuardrailPolicy,
    GuardrailRule,
    GuardrailTrigger,
    Severity,
    Source,
    Stage,
)
from tollms.models.request_log import ExportEvent, RequestLog, RequestStatus  # noqa: F401
from tollms.models.search_index import ConversationSearchEntry  # noqa: F401
from tollms.models.share import ConversationShare  # noqa: F401
from tollms.models.usage_aggregate import UsageDailyAggregate  # noqa: F401
from tollms.models.user import AuthProvider, PlatformRole, User  # noqa: F401
