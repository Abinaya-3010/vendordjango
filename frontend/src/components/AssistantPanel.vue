
<template>
  <div class="column no-wrap fit assistant-panel">
    <!-- Header -->
    <div class="row items-center q-pa-sm q-gutter-x-xs">
      <div class="text-subtitle1 col">
        {{ displayAssistantName }}
        <div class="text-caption text-grey-5">
          {{ t.title }}
        </div>
      </div>

      <q-btn
        flat
        dense
        round
        size="sm"
        icon="edit"
        aria-label="Customize assistant name"
        @click="openNameSettings"
      >
        <q-tooltip>Customize assistant name</q-tooltip>
      </q-btn>

      <q-select
        v-model="selectedLang"
        :options="langOptions"
        emit-value
        map-options
        dense
        dark
        borderless
        options-dense
        style="width: 95px"
        aria-label="Select language"
        @update:model-value="changeLang"
      />

      <q-btn
        flat
        dense
        round
        size="sm"
        :icon="a.state.voiceOutput ? 'volume_up' : 'volume_off'"
        :disable="!a.state.speechSupported"
        :aria-label="a.state.voiceOutput ? t.voiceOff : t.voiceOn"
        @click="a.setVoiceOutput(!a.state.voiceOutput)"
      >
        <q-tooltip>
          {{
            a.state.speechSupported
              ? (a.state.voiceOutput ? t.voiceOn : t.voiceOff)
              : t.speechNotSupported
          }}
        </q-tooltip>
      </q-btn>

      <q-btn
        flat
        dense
        round
        size="sm"
        icon="delete_sweep"
        :aria-label="t.clearConversation"
        @click="a.clear()"
      >
        <q-tooltip>{{ t.clearConversation }}</q-tooltip>
      </q-btn>
    </div>

    <q-separator dark />

    <!-- Conversation -->
    <div ref="scroller" class="col scroll q-pa-sm">
      <div
        v-if="!a.state.messages.length"
        class="text-grey-5 q-pa-sm"
      >
        {{ t.intro }}

        <div class="q-mt-sm">
          <q-chip
            v-for="s in currentSuggestions"
            :key="s"
            clickable
            dense
            dark
            outline
            size="sm"
            @click="a.submit(s)"
          >
            {{ s }}
          </q-chip>
        </div>
      </div>

      <div
        v-for="m in a.state.messages"
        :key="m.id"
        class="row q-mb-sm"
        :class="
          m.role === 'user'
            ? 'justify-end'
            : 'justify-start'
        "
      >
        <div
          class="bubble"
          :class="'bubble-' + m.role"
        >
          {{ m.text }}
        </div>
      </div>

      <div
        v-if="a.state.status === 'processing'"
        class="row items-center text-grey-5 q-pa-xs"
      >
        <q-spinner-dots
          size="24px"
          class="q-mr-sm"
        />
        {{ t.thinking }}
      </div>
    </div>

    <q-banner
      v-if="!a.state.micSupported"
      dense
      class="bg-grey-9 text-grey-4 text-caption"
    >
      {{ t.micNotSupported }}
    </q-banner>

    <div
      class="q-px-sm text-caption text-grey-5"
      aria-live="polite"
    >
      {{ statusText }}
    </div>

    <!-- Input -->
    <div class="row items-center no-wrap q-pa-sm q-gutter-x-xs">
      <q-btn
        round
        dense
        :color="listening ? 'negative' : 'deep-purple'"
        :icon="listening ? 'stop' : 'mic'"
        :disable="
          !a.state.micSupported ||
          a.state.status === 'processing'
        "
        :aria-label="listening ? t.stopListening : t.startVoice"
        @click="a.toggleMic()"
      >
        <q-tooltip>
          {{ listening ? t.stopListening : t.speakPrompt }}
        </q-tooltip>
      </q-btn>

      <q-input
        v-model="text"
        class="col"
        dense
        dark
        outlined
        :placeholder="t.placeholder"
        maxlength="1000"
        :disable="a.state.status === 'processing'"
        @keyup.enter="send"
      />

      <q-btn
        v-if="a.state.status === 'speaking'"
        round
        dense
        color="warning"
        icon="volume_off"
        :aria-label="t.stopSpeaking"
        @click="a.stopSpeaking()"
      >
        <q-tooltip>{{ t.stopSpeaking }}</q-tooltip>
      </q-btn>

      <q-btn
        v-else
        round
        dense
        color="deep-purple"
        icon="send"
        :disable="
          !text.trim() ||
          a.state.status === 'processing'
        "
        :aria-label="t.send"
        @click="send"
      />
    </div>

    <!-- Assistant name settings -->
    <q-dialog v-model="nameDialog">
      <q-card style="width: 350px; max-width: 90vw">
        <q-card-section>
          <div class="text-h6">
            Personalize your assistant
          </div>

          <div class="text-caption text-grey-7">
            Choose a name you like.
          </div>
        </q-card-section>

        <q-card-section>
          <q-input
            v-model="nameDraft"
            autofocus
            maxlength="40"
            label="Assistant name"
            outlined
            :rules="[
              value => !!value.trim() || 'Enter a name'
            ]"
            @keyup.enter="saveAssistantName"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn
            flat
            label="Cancel"
            v-close-popup
          />

          <q-btn
            color="deep-purple"
            label="Save"
            :disable="!nameDraft.trim()"
            @click="saveAssistantName"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import {
  computed,
  nextTick,
  onMounted,
  ref,
  watch,
} from 'vue'

import { useRouter } from 'vue-router'

import {
  ALLOWED_PATHS,
  createAssistant,
} from '../assistant/useAssistant'

import { askAssistant } from '../assistant/assistantService'

import {
  BrowserSpeechRecognizer,
} from '../voice/providers/BrowserSpeechRecognizer.js'

import {
  BrowserSpeechSynthesizer,
} from '../voice/providers/BrowserSpeechSynthesizer.js'

const router = useRouter()

const text = ref('')
const scroller = ref(null)

const selectedLang = ref('en-US')

const langOptions = [
  { label: 'English', value: 'en-US' },
  { label: 'Español', value: 'es-ES' },
]

// User-specific browser preference.
// A backend preference API can replace this later
// if names must follow users across different devices.
const ASSISTANT_NAME_KEY = 'vendorpro.assistant.name'

function readAssistantName() {
  try {
    return (
      localStorage.getItem(ASSISTANT_NAME_KEY)?.trim() || ''
    )
  } catch {
    return ''
  }
}

const assistantName = ref(readAssistantName())
const nameDialog = ref(false)
const nameDraft = ref(assistantName.value)

const displayAssistantName = computed(
  () => assistantName.value || 'Assistant',
)

function openNameSettings() {
  nameDraft.value = assistantName.value
  nameDialog.value = true
}

function saveAssistantName() {
  const name = nameDraft.value.trim().slice(0, 40)

  if (!name) return

  assistantName.value = name

  try {
    localStorage.setItem(ASSISTANT_NAME_KEY, name)
  } catch {
    // The current session still uses the selected name.
  }

  // Update the greeting if it is already visible.
  const greetingMessage = a.state.messages.find(
    (message) => message.id === 'assistant-greeting',
  )

  if (greetingMessage) {
    greetingMessage.text = createGreeting(name)
  }

  nameDialog.value = false
}

const translations = {
  'en-US': {
    title: 'VendorPro Assistant',
    voiceOn: 'Voice replies on',
    voiceOff: 'Voice replies off',
    speechNotSupported: 'Speech output not supported in this browser',
    clearConversation: 'Clear conversation',
    intro: 'Ask about vendors, RFQs, quotations, purchase orders, invoices or inventory — type, or tap the microphone.',
    suggestions: [
      'Show me all vendors',
      'Which RFQs are pending?',
      'Show overdue invoices',
      'Low stock items',
    ],
    thinking: 'Thinking…',
    micNotSupported: "Voice input isn't supported in this browser (try Chrome or Edge). You can still type.",
    status: {
      idle: '',
      listening: 'Listening… speak now',
      processing: 'Processing…',
      speaking: 'Speaking…',
    },
    stopListening: 'Stop listening',
    startVoice: 'Start voice input',
    speakPrompt: 'Speak your question',
    placeholder: 'Ask a question…',
    stopSpeaking: 'Stop speaking',
    send: 'Send',
  },

  'es-ES': {
    title: 'Asistente VendorPro',
    voiceOn: 'Respuestas de voz activas',
    voiceOff: 'Respuestas de voz desactivadas',
    speechNotSupported: 'La síntesis de voz no es compatible con este navegador',
    clearConversation: 'Borrar conversación',
    intro: 'Pregunta sobre proveedores, RFQ, cotizaciones, órdenes de compra, facturas o inventario — escribe o toca el micrófono.',
    suggestions: [
      'Muéstrame todos los proveedores',
      '¿Qué RFQ están pendientes?',
      'Mostrar facturas vencidas',
      'Artículos con stock bajo',
    ],
    thinking: 'Pensando…',
    micNotSupported: 'El reconocimiento de voz no es compatible con este navegador (prueba Chrome o Edge). Aún puedes escribir.',
    status: {
      idle: '',
      listening: 'Escuchando… habla ahora',
      processing: 'Procesando…',
      speaking: 'Hablando…',
    },
    stopListening: 'Dejar de escuchar',
    startVoice: 'Iniciar entrada de voz',
    speakPrompt: 'Di tu pregunta',
    placeholder: 'Haz una pregunta…',
    stopSpeaking: 'Dejar de hablar',
    send: 'Enviar',
  },
}

const t = computed(
  () => translations[selectedLang.value] || translations['en-US'],
)

const currentSuggestions = computed(
  () => t.value.suggestions,
)

const a = createAssistant({
  ask: askAssistant,
  navigate: (path) => router.push(path),
  allowedPaths: ALLOWED_PATHS,
  canNavigate: (path) =>
    router.getRoutes().some((route) => route.path === path),
  recognizer: new BrowserSpeechRecognizer(),
  synthesizer: new BrowserSpeechSynthesizer({
    lang: selectedLang.value,
  }),
  lang: selectedLang.value,
  getPathname: () => router.currentRoute.value.path,
})

function createGreeting(name) {
  if (selectedLang.value === 'es-ES') {
    return `¡Hola! Soy ${name}. ¿Cómo puedo ayudarte hoy?`
  }

  return `Hey! I'm ${name}. How can I help you today?`
}

// Show a greeting once when this panel is first mounted.
// This displays text; it does not automatically activate the microphone.
onMounted(() => {
  if (a.state.messages.length > 0) return

  a.state.messages.push({
    id: 'assistant-greeting',
    role: 'assistant',
    text: createGreeting(displayAssistantName.value),
  })
})

function changeLang(value) {
  selectedLang.value = value
  a.setLang(value)

  const greetingMessage = a.state.messages.find(
    (message) => message.id === 'assistant-greeting',
  )

  if (greetingMessage) {
    greetingMessage.text = createGreeting(displayAssistantName.value)
  }
}

const listening = computed(
  () => a.state.status === 'listening',
)

const statusText = computed(
  () => t.value.status[a.state.status] || '',
)

function send() {
  const messageText = text.value
  text.value = ''
  a.submit(messageText)
}

watch(
  () => [a.state.messages.length, a.state.status],
  async () => {
    await nextTick()

    if (scroller.value) {
      scroller.value.scrollTop = scroller.value.scrollHeight
    }
  },
)
</script>

<style scoped>
.assistant-panel {
  background: #12121a;
  color: #e2e8f0;
}

.bubble {
  max-width: 88%;
  padding: 8px 12px;
  border-radius: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.bubble-user {
  background: #5e35b1;
}

.bubble-assistant {
  background: #1e1e2e;
  border: 1px solid #303044;
}

.bubble-error {
  background: #5a1a22;
  border: 1px solid #b71c1c;
}

.bubble-system {
  background: transparent;
  color: #9aa;
  font-style: italic;
}
</style>
