

__version__ = (1, 2, 2)

# meta developer: @xfceq    

import os
import io
import re
import base64
import logging
from telethon.tl.types import Message, DocumentAttributeFilename
from telethon.utils import get_display_name
from .. import loader, utils

logger = logging.getLogger(__name__)

try:
    import openai
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

DB_HISTORY_KEY = "leetob_conversations_v1"

STYLIZED_MAP = str.maketrans("0123456789", "𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿")

MODELS_LIST = [
    "claude-haiku-4.5",
    "claude-opus-4.5",
    "claude-opus-4.5-thinking",
    "claude-sonnet-4",
    "claude-sonnet-4.5",
    "claude-sonnet-4.5-thinking",
    "gemini-2.5-computer-use-preview",
    "gemini-2.5-flash",
    "gemini-2.5-flash-image",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3-pro-image-preview",
    "gemini-3-pro-preview",
]

class Leetob(loader.Module):
    """using open.anycorp.dev"""
    
    strings = {
        "name": "leetob",
        "cfg_api_key": "<b>api key</b>",
        "cfg_base_url": "<b>base url (don't change)</b>",
        "cfg_model": "<b>model name, get it from open.anycorp.dev</b>",
        "cfg_image_model": "<b>model for image generation</b>",
        "cfg_image_base_url": "<b>base url for images (optional)</b>",
        "cfg_system_prompt": "<b>system instruction</b>",
        "cfg_max_history": "<b>0 for no limit</b>",
        "no_openai": "<b>for work you need to install openai library\n <code>pip install openai</code></b>",
        "processing": "<b>waiting...</b>",
        "generating": "<b>generating...</b>",
        "no_api_key": "<b>no api key</b>",
        "api_error": "<b>api error:</b>\n<code>{}</code>",
        "memory_cleared": "<b>memory cleared</b>",
        "memory_empty": "<b>no memory</b>",
        "response_prefix": "<b>response</b>",
        "question_prefix": "<b>reply</b>",
        "btn_clear": "clear",
        "btn_regenerate": "regenerate",
    }

    def __init__(self):
        self.config = loader.ModuleConfig(
            loader.ConfigValue("api_key", "sk-public", self.strings["cfg_api_key"], validator=loader.validators.Hidden()),
            loader.ConfigValue("base_url", "https://open.anycorp.dev/v1", self.strings["cfg_base_url"]),
            loader.ConfigValue("image_base_url", "", self.strings["cfg_image_base_url"]),
            loader.ConfigValue("model_name", "gemini-3-flash-preview", self.strings["cfg_model"]),
            loader.ConfigValue("image_model_name", "gemini-2.5-flash-image", self.strings["cfg_image_model"]),
            loader.ConfigValue("system_instruction", "Ты полезный и умный ассистент.", self.strings["cfg_system_prompt"]),
            loader.ConfigValue("max_history_length", 20, self.strings["cfg_max_history"], validator=loader.validators.Integer(minimum=0)),
        )
        self.conversations = {}

    async def client_ready(self, client, db):
        self.client = client
        self.db = db
        self.me = await client.get_me()
        self.conversations = self.db.get(self.strings["name"], DB_HISTORY_KEY, {})

    async def _get_client(self, is_image=False):
        if not OPENAI_AVAILABLE:
            raise ImportError("openai library missing")
            
        base_url = self.config["base_url"]
        if is_image and self.config["image_base_url"]:
             base_url = self.config["image_base_url"]

        return openai.AsyncOpenAI(
            api_key=self.config["api_key"],
            base_url=base_url
        )

    async def _prepare_content(self, message: Message, custom_text: str = None):
        content_blocks = []
        user_text = custom_text if custom_text is not None else utils.get_args_raw(message)
        
        reply = await message.get_reply_message()
        reply_context = ""
        file_info = None
        
        if reply:
            sender = await reply.get_sender()
            name = get_display_name(sender) if sender else "Unknown"
            if reply.text:
                reply_context = f"[Reply to {name}: {reply.text}]\n"
        
        full_text = f"{reply_context}{user_text}".strip()
        
        media_msg = message if (message.media or message.photo) else reply
        has_media = media_msg and (media_msg.media or media_msg.photo)
        
        if has_media:
            if media_msg.photo or (hasattr(media_msg, "document") and media_msg.document and media_msg.document.mime_type and media_msg.document.mime_type.startswith("image/")):
                try:
                    blob = await self.client.download_media(media_msg, bytes)
                    b64 = base64.b64encode(blob).decode('utf-8')
                    mime = "image/jpeg"
                    if hasattr(media_msg, "document") and media_msg.document and media_msg.document.mime_type:
                        mime = media_msg.document.mime_type
                    
                    content_blocks.append({
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime};base64,{b64}"
                        }
                    })
                except Exception as e:
                    logger.error(f"Image processing error: {e}")
            
            elif hasattr(media_msg, "document") and media_msg.document:
                mime = getattr(media_msg.document, "mime_type", "")
                fname = next((attr.file_name for attr in media_msg.document.attributes if isinstance(attr, DocumentAttributeFilename)), "file")
                if mime.startswith("text/") or fname.endswith(('.txt', '.py', '.js', '.json', '.md', '.html', '.css', '.ts', '.jsx', '.tsx', '.yaml', '.yml', '.xml', '.sh', '.bat', '.c', '.cpp', '.h', '.java', '.go', '.rs', '.rb', '.php', '.lua', '.sql')):
                    try:
                        data = await self.client.download_media(media_msg, bytes)
                        text_content = data.decode('utf-8', errors='ignore')
                        full_text += f"\n\n[File Content '{fname}':\n```\n{text_content}\n```]"
                        file_info = {"name": fname, "original_content": text_content}
                    except Exception:
                        pass

        if full_text:
            content_blocks.insert(0, {"type": "text", "text": full_text})
            
        if not content_blocks:
            return None, None
            
        return content_blocks, file_info

    def _detect_code_language(self, text):
        lang_ext = {
            'python': '.py', 'py': '.py',
            'javascript': '.js', 'js': '.js',
            'typescript': '.ts', 'ts': '.ts',
            'java': '.java',
            'cpp': '.cpp', 'c++': '.cpp',
            'c': '.c',
            'csharp': '.cs', 'c#': '.cs', 'cs': '.cs',
            'go': '.go', 'golang': '.go',
            'rust': '.rs', 'rs': '.rs',
            'ruby': '.rb', 'rb': '.rb',
            'php': '.php',
            'swift': '.swift',
            'kotlin': '.kt', 'kt': '.kt',
            'scala': '.scala',
            'html': '.html',
            'css': '.css',
            'scss': '.scss', 'sass': '.sass',
            'sql': '.sql',
            'bash': '.sh', 'sh': '.sh', 'shell': '.sh',
            'powershell': '.ps1', 'ps1': '.ps1',
            'yaml': '.yaml', 'yml': '.yaml',
            'json': '.json',
            'xml': '.xml',
            'markdown': '.md', 'md': '.md',
            'lua': '.lua',
            'perl': '.pl',
            'r': '.r',
            'dart': '.dart',
            'vue': '.vue',
            'jsx': '.jsx',
            'tsx': '.tsx',
        }
        
        match = re.search(r'```(\w+)\s*\n', text)
        if match:
            lang = match.group(1).lower()
            if lang in lang_ext:
                return lang_ext[lang], lang
        
        code_match = re.search(r'```\w*\s*\n(.+?)```', text, re.DOTALL)
        if code_match:
            code_content = code_match.group(1)
            if len(code_content) > len(text) * 0.5:
                return '.txt', 'code'
        
        return '.txt', None

    def _extract_code_from_response(self, text):
        code_match = re.search(r'```\w*\s*\n(.+?)```', text, re.DOTALL)
        if code_match:
            return code_match.group(1)
        return text

    async def _send_request(self, chat_id, content_blocks, status_msg=None, regeneration=False, reply_to=None, file_info=None):
        try:
            client = await self._get_client()
            history_key = str(chat_id)
            
            messages = []
            
            messages.append({"role": "system", "content": self.config["system_instruction"]})
            
            if history_key in self.conversations:
                raw_hist = self.conversations[history_key]
                limit = self.config["max_history_length"]
                if limit > 0:
                    raw_hist = raw_hist[-(limit*2):]
                messages.extend(raw_hist)
            
            if not regeneration:
                messages.append({"role": "user", "content": content_blocks})
            
            response = await client.chat.completions.create(
                model=self.config["model_name"],
                messages=messages,
                max_tokens=4096
            )
            
            result_text = response.choices[0].message.content
            
            if not regeneration:
                text_repr = next((b['text'] for b in content_blocks if b['type'] == 'text'), "[Media]")
                self.conversations.setdefault(history_key, []).append({"role": "user", "content": text_repr})
            
            self.conversations.setdefault(history_key, []).append({"role": "assistant", "content": result_text})
            self._save_db()

            last_msg_content = messages[-1]['content']
            if isinstance(last_msg_content, list):
                user_display_text = next((b['text'] for b in last_msg_content if b.get('type') == 'text'), "[Media]")
            else:
                user_display_text = str(last_msg_content)

            msg_count = len(self.conversations.get(history_key, [])) // 2
            count_styled = str(msg_count).translate(STYLIZED_MAP)
            
            formatted = (
                f"{self.strings['question_prefix']} <b>[{count_styled}]:</b>\n"
                f"<blockquote expandable>{utils.escape_html(user_display_text)}</blockquote>\n\n"
                f"{self.strings['response_prefix']}\n"
                f"<blockquote expandable>{utils.escape_html(result_text)}</blockquote>"
            )
            
            buttons = [
                {"text": self.strings["btn_clear"], "callback": self._clear_cb, "args": (chat_id,)},
                {"text": self.strings["btn_regenerate"], "callback": self._regen_cb, "args": (chat_id,)}
            ]

            if file_info:
                extracted_code = self._extract_code_from_response(result_text)
                file = io.BytesIO(extracted_code.encode('utf-8'))
                file.name = file_info["name"]
                escaped_name = utils.escape_html(file_info["name"])
                
                await self.client.send_file(
                    chat_id,
                    file,
                    caption=f"<b>edited:</b> <code>{escaped_name}</code>",
                    force_document=True,
                    attributes=[DocumentAttributeFilename(file_name=file_info["name"])]
                )
                
                text_without_code = re.sub(r'```\w*\s*\n.+?```', '', result_text, flags=re.DOTALL).strip()
                if text_without_code:
                    short_text = (
                        f"{self.strings['question_prefix']} <b>[{count_styled}]:</b>\n"
                        f"<blockquote>{utils.escape_html(user_display_text[:300])}</blockquote>\n\n"
                        f"{self.strings['response_prefix']}\n"
                        f"<blockquote>{utils.escape_html(text_without_code[:1500])}</blockquote>"
                    )
                    if status_msg:
                        await utils.answer(status_msg, short_text, reply_markup=buttons)
                    else:
                        await self.client.send_message(chat_id, short_text, buttons=buttons)
                elif status_msg:
                    await status_msg.delete()
                return

            ext, lang = self._detect_code_language(result_text)
            has_code_block = bool(re.search(r'```\w*\s*\n.+?```', result_text, re.DOTALL))
            
            should_send_file = len(formatted) > 4096 or (has_code_block and lang)
            
            if should_send_file:
                filename = f"response{ext}"
                
                code_match = re.search(r'```\w*\s*\n(.+?)```', result_text, re.DOTALL)
                if code_match and ext != '.txt':
                    file_content = code_match.group(1)
                    text_without_code = re.sub(r'```\w*\s*\n.+?```', '', result_text, flags=re.DOTALL).strip()
                else:
                    file_content = result_text
                    text_without_code = None
                
                file = io.BytesIO(file_content.encode('utf-8'))
                file.name = filename
                
                file_caption = f"<b>{self.strings['response_prefix']}</b>"
                if lang:
                    file_caption += f" <code>[{lang}]</code>"
                
                await self.client.send_file(
                    chat_id,
                    file,
                    caption=file_caption
                )
                
                msg_parts = []
                msg_parts.append(f"{self.strings['question_prefix']} <b>[{count_styled}]:</b>")
                msg_parts.append(f"\n<blockquote>{utils.escape_html(user_display_text[:300])}</blockquote>\n")
                
                if text_without_code:
                    truncated = text_without_code[:2000] + "..." if len(text_without_code) > 2000 else text_without_code
                    msg_parts.append(f"\n{self.strings['response_prefix']}\n")
                    msg_parts.append(f"<blockquote>{utils.escape_html(truncated)}</blockquote>")
                
                text_msg = "".join(msg_parts)
                
                if status_msg:
                    await utils.answer(status_msg, text_msg, reply_markup=buttons)
                else:
                    await self.client.send_message(chat_id, text_msg, buttons=buttons)
            else:
                if status_msg:
                    await utils.answer(status_msg, formatted, reply_markup=buttons)
                else:
                    await utils.answer(reply_to or chat_id, formatted, reply_markup=buttons)

        except Exception as e:
            err = str(e)
            logger.error(f"Leetob Error: {err}")
            msg = self.strings["api_error"].format(utils.escape_html(err))
            if status_msg: await utils.answer(status_msg, msg)

    @loader.command()
    async def l(self, message: Message):
        """<text/reply> — reply."""
        if not OPENAI_AVAILABLE: return await utils.answer(message, self.strings["no_openai"])
        
        user_text = utils.get_args_raw(message)
        if user_text:
            processing_text = f"{self.strings['processing']}\n\n<b>prompt:</b>\n<blockquote expandable>{utils.escape_html(user_text)}</blockquote>"
        else:
            processing_text = self.strings["processing"]
        status = await utils.answer(message, processing_text)
        content, file_info = await self._prepare_content(message)
        
        if not content:
            return await utils.answer(status, "❌ <b>No text or media to process.</b>")
            
        await self._send_request(utils.get_chat_id(message), content, status_msg=status, file_info=file_info)

    @loader.command()
    async def lig(self, message: Message):
        """<prompt> - generate/edit image."""
        if not OPENAI_AVAILABLE: return await utils.answer(message, self.strings["no_openai"])
        
        args = utils.get_args_raw(message)
        if not args:
            return await utils.answer(message, "<b>please provide a prompt for image generation.</b>")
            
        processing_text = f"{self.strings['generating']}\n\n<b>prompt:</b>\n<blockquote expandable>{utils.escape_html(args)}</blockquote>"
        status = await utils.answer(message, processing_text)
        
        try:
            client = await self._get_client(is_image=True)
            
            reply = await message.get_reply_message()
            input_image_b64 = None
            
            if reply:
                media_msg = reply
                if media_msg.photo or (hasattr(media_msg, "document") and media_msg.document and media_msg.document.mime_type and media_msg.document.mime_type.startswith("image/")):
                    try:
                        blob = await self.client.download_media(media_msg, bytes)
                        input_image_b64 = base64.b64encode(blob).decode('utf-8')
                    except Exception as e:
                        logger.error(f"Failed to download reply image: {e}")
            
            if input_image_b64:
                user_content = [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{input_image_b64}"}
                    },
                    {
                        "type": "text",
                        "text": f"Edit this image: {args}"
                    }
                ]
            else:
                user_content = f"Generate an image: {args}"
            
            response = await client.chat.completions.create(
                model=self.config["image_model_name"],
                messages=[
                    {"role": "user", "content": user_content}
                ],
                max_tokens=4096
            )
            
            raw = response.model_dump() if hasattr(response, 'model_dump') else {}
            
            image_data = None
            image_url = None
            
            choices = raw.get('choices', [])
            if choices:
                msg = choices[0].get('message', {})
                
                images = msg.get('images', [])
                if images:
                    for img in images:
                        if img.get('type') == 'image_url':
                            url = img.get('image_url', {}).get('url', '')
                            if url.startswith('data:image'):
                                if ';base64,' in url:
                                    image_data = url.split(';base64,')[1]
                                else:
                                    image_url = url
                            elif url:
                                image_url = url
                            break
                
                if not image_data and not image_url:
                    content = msg.get('content')
                    if isinstance(content, list):
                        for part in content:
                            if isinstance(part, dict):
                                if 'inline_data' in part:
                                    image_data = part['inline_data'].get('data')
                                elif part.get('type') == 'image_url':
                                    image_url = part.get('image_url', {}).get('url')
            
            caption = f"<blockquote><b>Prompt:</b> {args}\n<b>Model:</b> {self.config['image_model_name']}</blockquote>"
            
            if image_data:
                img_bytes = base64.b64decode(image_data)
                file = io.BytesIO(img_bytes)
                file.name = "generated.jpg"
                await self.client.send_file(
                    utils.get_chat_id(message),
                    file,
                    caption=caption,
                    force_document=False
                )
                if status: await status.delete()
            elif image_url:
                if image_url.startswith('data:image'):
                    if ';base64,' in image_url:
                        img_bytes = base64.b64decode(image_url.split(';base64,')[1])
                        file = io.BytesIO(img_bytes)
                        file.name = "generated.jpg"
                        await self.client.send_file(
                            utils.get_chat_id(message),
                            file,
                            caption=caption,
                            force_document=False
                        )
                else:
                    await self.client.send_file(
                        utils.get_chat_id(message),
                        image_url,
                        caption=caption,
                        force_document=False
                    )
                if status: await status.delete()
            else:
                import json
                debug_str = json.dumps(raw, indent=2, default=str)[:1500]
                await utils.answer(status, f"<b>No image found. Raw:</b>\n<code>{utils.escape_html(debug_str)}</code>")

        except Exception as e:
            logger.error(f"Image Gen Error: {e}")
            await utils.answer(status, f"<b>Error:</b>\n<code>{str(e)[:500]}</code>")

    @loader.command()
    async def limodel(self, message: Message):
        """<model> — set image model."""
        args = utils.get_args_raw(message)
        if not args:
            return await utils.answer(message, f"current image model: <code>{self.config['image_model_name']}</code>")
        self.config["image_model_name"] = args.strip()
        await utils.answer(message, f"image model set: <code>{self.config['image_model_name']}</code>")


    @loader.command()
    async def lmodel(self, message: Message):
        """<model> — set model. -s for list"""
        args = utils.get_args_raw(message)
        
        if args == "-s":
             models_str = "\n".join([f"<code>{m}</code>" for m in MODELS_LIST])
             return await utils.answer(message, f"<b>Available models:</b>\n{models_str}")

        if not args:
            return await utils.answer(message, f"current model: <code>{self.config['model_name']}</code>")
        self.config["model_name"] = args.strip()
        await utils.answer(message, f"model set: <code>{self.config['model_name']}</code>")

    @loader.command()
    async def lclear(self, message: Message):
        """— clear chat history. (for current chat)"""
        cid = str(utils.get_chat_id(message))
        if cid in self.conversations:
            del self.conversations[cid]
            self._save_db()
            await utils.answer(message, self.strings["memory_cleared"])
        else:
            await utils.answer(message, self.strings["memory_empty"])

    @loader.command()
    async def lprompt(self, message: Message):
        """<text> — set system prompt."""
        args = utils.get_args_raw(message)
        if not args:
            return await utils.answer(message, f"current prompt:\n<code>{self.config['system_instruction']}</code>")
        self.config["system_instruction"] = args
        await utils.answer(message, "system prompt updated")

    async def _clear_cb(self, call, cid):
        if str(cid) in self.conversations:
            del self.conversations[str(cid)]
            self._save_db()
        await call.edit(self.strings["memory_cleared"], reply_markup=None)

    async def _regen_cb(self, call, cid):
        await call.answer("Регенерация пока не поддерживается полностью.", show_alert=False)
        await call.delete()

    def _save_db(self):
        self.db.set(self.strings["name"], DB_HISTORY_KEY, self.conversations)