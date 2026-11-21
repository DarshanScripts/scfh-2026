import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from onboarding.schema import ADAPTERS


def test_versioned_message_examples():
    examples = json.loads(Path(__file__).with_name("contract-examples.json").read_text(encoding="utf-8"))
    assert examples.keys() == ADAPTERS.keys()
    for name, adapter in ADAPTERS.items():
        adapter.validate_json(json.dumps(examples[name]["valid"]))
        with pytest.raises(ValidationError):
            adapter.validate_json(json.dumps(examples[name]["invalid"]))
