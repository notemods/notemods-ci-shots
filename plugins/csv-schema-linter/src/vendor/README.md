# Local Papa Parse build

Source is Papa Parse 5.7.0 from npm. License is MIT. The NetworkStreamer and DuplexStreamStreamer bodies are replaced with explicit errors. This removes unused network and Node stream code. The CSV parser and serializer are unchanged. CSV Rule Check uses string input only. Unit tests use this same local copy.
