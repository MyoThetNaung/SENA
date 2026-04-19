Place your .gguf model files in this folder (or set a custom folder in the Control Panel).

Ollama does not auto-load arbitrary paths. After adding a file, register it with Ollama, for example:

  ollama create mymodel -f Modelfile

Where Modelfile contains:

  FROM ./models/your-model.gguf

Then set "Model name" in the Control Panel to mymodel (or whatever name you used).
