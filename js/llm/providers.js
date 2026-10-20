/* Provider registry: fields shown in the UI, defaults and curated fallback models. */
(function (g) {
  'use strict';
  const PDA = (g.PDA = g.PDA || {});

  // fields: which inputs the settings panel shows for the provider.
  const PROVIDERS = {
    openai: {
      label: 'OpenAI',
      kind: 'openai',
      fields: ['apiKey', 'model'],
      keyRequired: true,
      defaultBaseUrl: 'https://api.openai.com/v1',
      listModels: true,
      fallbackModels: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini']
    },
    anthropic: {
      label: 'Anthropic',
      kind: 'anthropic',
      fields: ['apiKey', 'model'],
      keyRequired: true,
      defaultBaseUrl: 'https://api.anthropic.com/v1',
      listModels: true,
      fallbackModels: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']
    },
    mistral: {
      label: 'Mistral AI',
      kind: 'openai',
      fields: ['apiKey', 'model'],
      keyRequired: true,
      defaultBaseUrl: 'https://api.mistral.ai/v1',
      listModels: true,
      fallbackModels: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest']
    },
    azure: {
      label: 'Azure OpenAI / Azure AI Foundry',
      kind: 'azure',
      fields: ['azureMode', 'endpoint', 'apiKey', 'deployment', 'apiVersion', 'model'],
      keyRequired: true,
      listModels: false,
      defaultApiVersion: '2024-10-21',
      defaultFoundryApiVersion: '2024-05-01-preview',
      fallbackModels: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'Mistral-Large-2411', 'Llama-3.3-70B-Instruct'],
      endpointHosts: [/\.openai\.azure\.com$/, /\.cognitiveservices\.azure\.com$/, /\.services\.ai\.azure\.com$/, /\.inference\.ai\.azure\.com$/, /\.models\.ai\.azure\.com$/, /\.azure-api\.net$/]
    },
    ollama: {
      label: 'Ollama Cloud / compatible',
      kind: 'ollama',
      fields: ['baseUrl', 'apiKey', 'model'],
      keyRequired: false, // required for ollama.com, optional for a local Ollama on localhost
      defaultBaseUrl: 'https://ollama.com',
      listModels: true,
      fallbackModels: ['gpt-oss:120b', 'gpt-oss:20b', 'qwen3-coder:480b', 'deepseek-v3.1:671b']
    },
    compatible: {
      label: 'Endpoint compatible OpenAI (générique)',
      kind: 'openai',
      fields: ['baseUrl', 'apiKey', 'model'],
      keyRequired: false,
      defaultBaseUrl: '',
      listModels: true,
      fallbackModels: []
    }
  };

  function get(id) {
    return PROVIDERS[id] || null;
  }

  function list() {
    return Object.keys(PROVIDERS).map((id) => ({ id, label: PROVIDERS[id].label }));
  }

  PDA.providers = { PROVIDERS, get, list };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDA.providers;
})(typeof window !== 'undefined' ? window : globalThis);
