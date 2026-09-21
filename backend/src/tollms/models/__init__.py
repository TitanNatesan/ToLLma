"""ORM entities. Importing this package registers every table on Base.metadata."""

from tollms.models.attachment import Attachment  # noqa: F401
from tollms.models.conversation import Conversation  # noqa: F401
from tollms.models.message import Message, Role  # noqa: F401
from tollms.models.message_history import GenerationRun, MessageVersion  # noqa: F401
from tollms.models.model_repository import RepositoryModel, RepositorySource, SyncRun  # noqa: F401
from tollms.models.password_reset import PasswordResetToken  # noqa: F401
from tollms.models.provider import Provider, ProviderType  # noqa: F401
from tollms.models.registered_model import AIModel, EndpointType  # noqa: F401
from tollms.models.request_log import ExportEvent, RequestLog, RequestStatus  # noqa: F401
from tollms.models.search_index import ConversationSearchEntry  # noqa: F401
from tollms.models.share import ConversationShare  # noqa: F401
from tollms.models.user import AuthProvider, User  # noqa: F401
