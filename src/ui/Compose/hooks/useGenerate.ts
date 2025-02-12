import { useEditorConfigContext } from '@payloadcms/richtext-lexical/client'
import { useConfig, useField, useFieldProps, useForm, useLocale } from '@payloadcms/ui'
import { jsonSchema } from 'ai'
import { useCompletion, experimental_useObject as useObject } from 'ai/react'
import { useCallback, useEffect, useMemo } from 'react'

import type { ActionMenuItems, GenerateTextarea } from '../../../types.js'

import {
  PLUGIN_API_ENDPOINT_GENERATE,
  PLUGIN_API_ENDPOINT_GENERATE_UPLOAD,
  PLUGIN_INSTRUCTIONS_TABLE,
  PLUGIN_NAME,
} from '../../../defaults.js'
import { useInstructions } from '../../../providers/InstructionsProvider/useInstructions.js'
import { setSafeLexicalState } from '../../../utilities/setSafeLexicalState.js'
import { useHistory } from './useHistory.js'

type ActionCallbackParams = { action: ActionMenuItems; params?: unknown }

export const useGenerate = () => {
  const { type, path: pathFromContext, schemaPath } = useFieldProps()
  const editorConfigContext = useEditorConfigContext()
  const { editor } = editorConfigContext

  const { config } = useConfig()
  const {
    routes: { api },
    serverURL,
  } = config

  const { setValue } = useField<string>({
    path: pathFromContext,
  })

  const { set: setHistory } = useHistory()
  const { id: instructionId } = useInstructions({
    path: schemaPath,
  })

  const { getData } = useForm()
  const localFromContext = useLocale()
  const {
    config: { collections },
  } = useConfig()

  const collection = collections.find((collection) => collection.slug === PLUGIN_INSTRUCTIONS_TABLE)
  const { custom: { [PLUGIN_NAME]: { editorConfig = {} } = {} } = {} } = collection.admin
  const { schema: editorSchema = {} } = editorConfig

  const memoizedSchema = useMemo(() => jsonSchema(editorSchema), [editorSchema])

  const {
    isLoading: loadingObject,
    object,
    stop, // TODO: Implement this function
    submit,
  } = useObject({
    api: `/api${PLUGIN_API_ENDPOINT_GENERATE}`,
    onError: (error) => {
      console.error('Error generating object:', error)
    },
    onFinish: (result) => {
      if (result.object) {
        setHistory(result.object)
        setValue(result.object)
      } else {
        console.log('onFinish: result ', result)
      }
    },
    schema: memoizedSchema,
  })

  useEffect(() => {
    if (!object) return

    requestAnimationFrame(() => {
      if (!editor) {
        setValue(object)
        return
      }

      // Currently this is being used as setValue for RichText component does not render new changes right away.
      setSafeLexicalState(object, editor)
    })
  }, [object])

  const {
    complete,
    completion,
    isLoading: loadingCompletion,
  } = useCompletion({
    api: `${serverURL}${api}${PLUGIN_API_ENDPOINT_GENERATE}`,
    onError: (error) => {
      console.error('Error generating text:', error)
    },
    onFinish: (prompt, result) => {
      setHistory(result)
    },
    streamProtocol: 'data',
  })

  useEffect(() => {
    if (!completion) return

    requestAnimationFrame(() => {
      setValue(completion)
    })
  }, [completion])

  const streamObject = useCallback(
    ({ action = 'Compose', params }: ActionCallbackParams) => {
      const doc = getData()
      const options = {
        action,
        actionParams: params,
        instructionId,
      }

      submit({
        doc,
        locale: localFromContext?.code,
        options,
      })
    },
    [getData, localFromContext?.code, instructionId],
  )

  const streamText = useCallback(
    async ({ action = 'Compose', params }: ActionCallbackParams) => {
      const doc = getData()

      const options = {
        action,
        actionParams: params,
        instructionId,
      }

      await complete('', {
        body: {
          doc,
          locale: localFromContext?.code,
          options,
        },
      })
    },
    [getData, localFromContext?.code, instructionId],
  )

  const generateUpload = useCallback(async () => {
    const doc = getData()

    return fetch(`${serverURL}${api}${PLUGIN_API_ENDPOINT_GENERATE_UPLOAD}`, {
      body: JSON.stringify({
        doc,
        locale: localFromContext?.code,
        options: {
          instructionId,
        },
      } satisfies Parameters<GenerateTextarea>[0]),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
      .then(async (uploadResponse) => {
        if (uploadResponse.ok) {
          const { result } = await uploadResponse.json()
          if (!result) throw new Error('generateUpload: Something went wrong')

          setValue(result?.id)
          setHistory(result?.id)
        } else {
          const { errors = [] } = await uploadResponse.json()
          const errStr = errors.map((error) => error.message).join(', ')
          throw new Error(errStr)
        }
        return uploadResponse
      })
      .catch((error) => {
        console.error('Error generating your upload', error)
      })
  }, [getData, localFromContext?.code, instructionId])

  const generate = useCallback(
    async (options?: ActionCallbackParams) => {
      if (type === 'richText') {
        return streamObject(options)
      }

      if (['text', 'textarea'].includes(type)) {
        return streamText(options)
      }

      if (type === 'upload') {
        return generateUpload()
      }
    },
    [generateUpload, streamObject, streamText, type],
  )

  return {
    generate,
    isLoading: loadingCompletion || loadingObject,
  }
}
