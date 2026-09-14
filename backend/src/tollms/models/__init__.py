"""ORM entities. Importing this package registers every table on Base.metadata."""

from tollms.models.conversation import Conversation  # noqa: F401
from tollms.models.message import Message, Role  # noqa: F401
from tollms.models.model_repository import RepositoryModel, RepositorySource, SyncRun  # noqa: F401
from tollms.models.provider import Provider, ProviderType  # noqa: F401
from tollms.models.registered_model import AIModel, EndpointType  # noqa: F401
from tollms.models.user import AuthProvider, User  # noqa: F401
