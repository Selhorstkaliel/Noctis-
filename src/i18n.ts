import { useStore } from "./store";

export const supportedLanguages = ["en-US", "pt-BR"] as const;
export type Language = (typeof supportedLanguages)[number];

const portuguese: Record<string, string> = {
  Image: "Imagem",
  "Close pinned messages": "Fechar mensagens fixadas",
  "Go to message": "Ir até a mensagem",
  "Go to message by {name}": "Ir até a mensagem de {name}",
  "We couldn't create this account. Try a different email or username. If you already registered, sign in or reset your password.":
    "Não foi possível criar a conta. Tente outro e-mail ou nome de usuário. Se você já se cadastrou, entre na conta ou redefina sua senha.",
  "Saving changes…": "Salvando alterações…",
  "This file could not be read. Choose it again.":
    "Não foi possível ler o arquivo. Selecione-o novamente.",
  "Choose a JPG, PNG, or WebP no larger than {size} KB.":
    "Escolha uma imagem JPG, PNG ou WebP de até {size} KB.",
  "Your image could not be read. Try another file.":
    "Não foi possível ler a imagem. Tente outro arquivo.",
  "Add a display name and username before saving.":
    "Preencha o nome de exibição e o nome de usuário antes de salvar.",
  "Use 3–30 letters, numbers, dots, or underscores for your username.":
    "Use de 3 a 30 letras, números, pontos ou sublinhados no nome de usuário.",
  "Account security": "Segurança da conta",
  "Close dialog": "Fechar janela",
  "Confirm your email before entering Noctis. Check your inbox or request a confirmation link.":
    "Confirme seu e-mail antes de entrar no Noctis. Confira sua caixa de entrada ou solicite um link de confirmação.",
  "Enter the six-digit code from your authenticator.":
    "Digite o código de seis dígitos do seu autenticador.",
  "Connection failed. Check your internet connection and try again.":
    "Falha na conexão. Confira sua internet e tente novamente.",
  "Forgot password?": "Esqueceu a senha?",
  "Reset your password": "Redefina sua senha",
  "Choose a new password": "Escolha uma nova senha",
  "Verify your email": "Confirme seu e-mail",
  "Two-factor authentication": "Autenticação em duas etapas",
  "We sent a confirmation link to your email. Confirm it before entering Noctis.":
    "Enviamos um link de confirmação para seu e-mail. Confirme antes de entrar no Noctis.",
  "Enter a code from your authenticator or an unused recovery code.":
    "Digite um código do autenticador ou um código de recuperação ainda não utilizado.",
  "Enter your account email. If password recovery is available, we will send a link.":
    "Digite o e-mail da conta. Se a recuperação de senha estiver disponível, enviaremos um link.",
  "Confirm this email to finish verifying your account.":
    "Confirme este e-mail para concluir a verificação da conta.",
  "Enter a valid email address.": "Digite um endereço de e-mail válido.",
  "If password recovery is available for this email, a link is on its way. Check your inbox and spam folder.":
    "Se a recuperação de senha estiver disponível para este e-mail, você receberá um link. Confira sua caixa de entrada e o spam.",
  "Email verified. You can now continue.":
    "E-mail confirmado. Você já pode continuar.",
  "Password changed. All sessions were signed out. Sign in with your new password.":
    "Senha alterada. Todas as sessões foram encerradas. Entre com sua nova senha.",
  "Authenticator or recovery code": "Código do autenticador ou de recuperação",
  "Required only if two-factor authentication is enabled.":
    "Obrigatório apenas se a autenticação em duas etapas estiver ativa.",
  "Verify and sign in": "Verificar e entrar",
  "Send recovery link": "Enviar link de recuperação",
  "Reset password": "Redefinir senha",
  "Confirm email": "Confirmar e-mail",
  "Open the link from your email. If it expired, request a new one.":
    "Abra o link recebido por e-mail. Se ele expirou, solicite um novo.",
  "I confirmed my email": "Já confirmei meu e-mail",
  "Your email has not been confirmed yet. Open the link in your inbox.":
    "Seu e-mail ainda não foi confirmado. Abra o link na sua caixa de entrada.",
  "A new confirmation link is on its way. Previous links no longer work.":
    "Um novo link de confirmação será enviado. Os links anteriores não funcionam mais.",
  "Resend in {seconds}s": "Reenviar em {seconds}s",
  "Resend confirmation email": "Reenviar e-mail de confirmação",
  "Back to sign in": "Voltar para entrar",
  "Show {label}": "Mostrar {label}",
  "Hide {label}": "Ocultar {label}",
  Show: "Mostrar",
  Hide: "Ocultar",
  "Loading account security…": "Carregando segurança da conta…",
  Verified: "Confirmado",
  "Not verified": "Não confirmado",
  "Your account requires an authenticator or recovery code when you sign in.":
    "Sua conta exige um código do autenticador ou de recuperação para entrar.",
  "Add a second step to protect your account, including provider sign-ins.":
    "Adicione uma segunda etapa para proteger sua conta, inclusive ao entrar com Google ou GitHub.",
  "{count} recovery codes remaining":
    "{count} códigos de recuperação restantes",
  Enabled: "Ativada",
  Disabled: "Desativada",
  "Replace recovery codes": "Substituir códigos de recuperação",
  "Disable two-factor authentication": "Desativar autenticação em duas etapas",
  "Set up authenticator": "Configurar autenticador",
  "Save your recovery codes": "Guarde seus códigos de recuperação",
  "These codes will not be shown again. Close without saving them?":
    "Estes códigos não serão exibidos novamente. Fechar sem guardá-los?",
  "Authenticator setup is not finished. Close setup?":
    "A configuração do autenticador não foi concluída. Fechar configuração?",
  "Keep open": "Manter aberto",
  "Each code works once. Keep these codes somewhere safe, separate from your password. They will not be shown again.":
    "Cada código funciona uma vez. Guarde-os em um lugar seguro, separado da sua senha. Eles não serão exibidos novamente.",
  "Hide recovery codes": "Ocultar códigos de recuperação",
  "Show recovery codes": "Mostrar códigos de recuperação",
  "I saved my recovery codes": "Guardei meus códigos de recuperação",
  "Your account will stop requiring a second factor. All other sessions will be signed out.":
    "Sua conta deixará de exigir a segunda etapa. Todas as outras sessões serão encerradas.",
  "All previous recovery codes will stop working. Other sessions will be signed out.":
    "Todos os códigos de recuperação anteriores deixarão de funcionar. As outras sessões serão encerradas.",
  "Use an authenticator app. Setup expires after 10 minutes. Other sessions will be signed out when you enable it.":
    "Use um aplicativo autenticador. A configuração expira em 10 minutos. As outras sessões serão encerradas após a ativação.",
  "For provider accounts, sign in again if your session is more than 5 minutes old.":
    "Para contas do Google ou GitHub, entre novamente se sua sessão tiver mais de 5 minutos.",
  "Scan this QR code with your authenticator, then enter its six-digit code.":
    "Leia este QR code com seu autenticador e digite o código de seis dígitos.",
  "Authenticator setup QR code": "QR code de configuração do autenticador",
  "Manual setup key": "Chave de configuração manual",
  "Six-digit code": "Código de seis dígitos",
  "Enable two-factor authentication": "Ativar autenticação em duas etapas",
  "Change password": "Alterar senha",
  "Current password": "Senha atual",
  "New password": "Nova senha",
  "Confirm new password": "Confirmar nova senha",
  "Update password": "Atualizar senha",
  "The new passwords do not match.": "As novas senhas não coincidem.",
  "Password updated. Other devices have been signed out.":
    "Senha atualizada. As sessões dos outros dispositivos foram encerradas.",
  "Current password is incorrect.": "A senha atual está incorreta.",
  "This link expired or was already used. Request a new email.":
    "Este link expirou ou já foi utilizado. Solicite um novo e-mail.",
  "Invalid or already used code. Try the next authenticator code or a recovery code.":
    "Código inválido ou já utilizado. Use o próximo código do autenticador ou um código de recuperação.",
  "Your sign-in request expired. Sign in again.":
    "Sua solicitação de entrada expirou. Entre novamente.",
  "Sign in again before changing account security.":
    "Entre novamente antes de alterar a segurança da conta.",
  "Verify your email before continuing.":
    "Confirme seu e-mail antes de continuar.",
  "Authenticator setup expired. Start setup again.":
    "A configuração do autenticador expirou. Comece novamente.",
  "Two-factor authentication is already enabled.":
    "A autenticação em duas etapas já está ativa.",
  "Too many attempts. Please wait before trying again.":
    "Muitas tentativas. Aguarde antes de tentar novamente.",
  Home: "Início",
  "Direct messages": "Mensagens diretas",
  Missions: "Missões",
  Events: "Eventos",
  "Discover servers": "Descobrir servidores",
  Discover: "Descobrir",
  Integrations: "Integrações",
  "The Lounge": "O Salão",
  "Welcome to Noctis": "Boas-vindas ao Noctis",
  "Server administration": "Administração do servidor",
  "Find your way": "Encontre seu caminho",
  "Main navigation": "Navegação principal",
  Explore: "Explorar",
  "Invite your people": "Convide sua comunidade",
  "Create a server": "Criar servidor",
  "Open {name}": "Abrir {name}",
  "{count} unread notifications": "{count} notificações não lidas",
  NEW: "NOVO",
  "{count} new": "{count} novas",
  "{count} online": "{count} online",
  Joined: "Participando",
  "{done} of {total} objectives": "{done} de {total} objetivos",
  "{name} progress": "Progresso de {name}",
  "YOUR COMMUNITIES": "SUAS COMUNIDADES",
  "RECENT CONVERSATIONS": "CONVERSAS RECENTES",
  "New conversation": "Nova conversa",
  "A space for your people.": "Um espaço para a sua comunidade.",
  "Make yourself at home.": "Fique à vontade.",
  "User settings": "Configurações do usuário",
  Online: "Online",
  Away: "Ausente",
  Invisible: "Invisível",
  "Try again": "Tentar novamente",
  "Finding your space…": "Encontrando seu espaço…",
  "Your space is temporarily out of reach.":
    "Seu espaço está temporariamente indisponível.",
  "Connecting securely to Noctis.": "Conectando com segurança ao Noctis.",
  "A little off the map.": "Um pouco fora do mapa.",
  "That space doesn't exist. Your people are still here.":
    "Esse espaço não existe. Sua comunidade continua aqui.",
  "Back to Home": "Voltar ao início",
  "Skip to content": "Pular para o conteúdo",
  "Server switcher": "Seletor de servidores",
  "Noctis Home": "Início do Noctis",
  "Keyboard shortcuts": "Atalhos de teclado",
  "Open navigation": "Abrir navegação",
  "Your world, a little closer.": "Seu mundo, um pouco mais perto.",
  "A place for the everyday conversations.":
    "Um lugar para as conversas do dia a dia.",
  "All caught up with your world": "Tudo em dia com o seu mundo",
  "Search Noctis": "Pesquisar no Noctis",
  Notifications: "Notificações",
  "View members and friends": "Ver membros e amigos",
  "Browser storage is full. Changes will last for this session. Remove a large attachment or allow browser storage.":
    "O armazenamento do navegador está cheio. As alterações durarão apenas nesta sessão. Remova um anexo grande ou permita o armazenamento.",
  "You're offline. Your local conversations and drafts are still available.":
    "Você está offline. Suas conversas locais e rascunhos continuam disponíveis.",
  "Your spaces": "Seus espaços",
  "Sign out": "Sair",
  "My account": "Minha conta",
  "Privacy & safety": "Privacidade e segurança",
  Appearance: "Aparência",
  "Voice & devices": "Voz e dispositivos",
  Connections: "Conexões",
  "Language & region": "Idioma e região",
  Settings: "Configurações",
  "YOUR NOCTIS": "SEU NOCTIS",
  "A little about you. Make it feel like home.":
    "Um pouco sobre você. Deixe este espaço com a sua cara.",
  "Set things up the way you like them.":
    "Configure tudo do jeito que você preferir.",
  "Change avatar": "Alterar foto",
  "Email address": "Endereço de e-mail",
  "Display name": "Nome de exibição",
  Username: "Nome de usuário",
  "This is how your people find you.": "É assim que as pessoas encontram você.",
  "About me": "Sobre mim",
  "Custom status": "Status personalizado",
  Presence: "Presença",
  "Your profile is saved to your account and follows you across devices.":
    "Seu perfil é salvo na conta e acompanha você em todos os dispositivos.",
  "Choose your comfort zone.": "Escolha seu nível de privacidade.",
  "Allow conversations with people in your communities.":
    "Permitir conversas com pessoas das suas comunidades.",
  "Friend requests": "Solicitações de amizade",
  "Let other members find you and send a friend request.":
    "Permitir que outros membros encontrem você e enviem uma solicitação de amizade.",
  "Activity status": "Status de atividade",
  "Share what you're playing, listening to, or working on.":
    "Compartilhar o que você está jogando, ouvindo ou fazendo.",
  "Your privacy settings control access across Noctis.":
    "Suas configurações de privacidade controlam o acesso em todo o Noctis.",
  "Find your shade of night.": "Encontre o seu tom da noite.",
  "Smooth motion": "Movimento suave",
  "Subtle transitions that make your space feel a little more alive. Your system's reduced-motion preference always takes priority.":
    "Transições sutis deixam seu espaço mais vivo. A preferência de movimento reduzido do sistema sempre tem prioridade.",
  "Your appearance preference follows you throughout Noctis on this browser.":
    "Sua preferência de aparência acompanha você no Noctis neste navegador.",
  "Stay in the loop. Keep your peace.":
    "Acompanhe o que importa sem perder a tranquilidade.",
  "In-app notifications": "Notificações no aplicativo",
  "Show activity in your notification center.":
    "Mostrar atividades na central de notificações.",
  "Mentions & replies": "Menções e respostas",
  "Get a heads-up when the conversation includes you.":
    "Receber um aviso quando você participar da conversa.",
  "Notification sounds": "Sons de notificação",
  "Play a subtle sound for new message notifications.":
    "Reproduzir um som discreto para novas mensagens.",
  "Your notification preferences are saved to your account.":
    "Suas preferências de notificação são salvas na conta.",
  "A little more of your world.": "Um pouco mais do seu mundo.",
  "Account connected": "Conta conectada",
  Manage: "Gerenciar",
  "You haven't connected any external accounts yet.":
    "Você ainda não conectou nenhuma conta externa.",
  "Explore integrations": "Explorar integrações",
  "Choose how Noctis speaks to you.": "Escolha como o Noctis fala com você.",
  "Language changes after you save and follows your account on every device.":
    "O idioma muda depois de salvar e acompanha sua conta em todos os dispositivos.",
  English: "Inglês",
  Portuguese: "Português",
  "United States": "Estados Unidos",
  Brazil: "Brasil",
  "You have unsaved changes.": "Você tem alterações não salvas.",
  "You're all set.": "Tudo pronto.",
  Reset: "Redefinir",
  "Save changes": "Salvar alterações",
  "Changes saved": "Alterações salvas",
  "Leave these changes behind?": "Descartar estas alterações?",
  "Keep editing": "Continuar editando",
  "Discard changes": "Descartar alterações",
  "YOUR SPACE. YOUR PEOPLE.": "SEU ESPAÇO. SUA COMUNIDADE.",
  morning: "bom dia",
  afternoon: "boa tarde",
  evening: "boa noite",
  "A little connection goes a long way. Welcome back.":
    "Um pouco de conexão faz toda a diferença. Que bom ter você de volta.",
  "MORE THAN A CONVERSATION": "MAIS QUE UMA CONVERSA",
  "Find your people.": "Encontre sua comunidade.",
  "Make your space.": "Crie o seu espaço.",
  "Somewhere to belong. Something to build.":
    "Um lugar para pertencer. Algo para construir.",
  "The next good thing starts with a hello.":
    "A próxima coisa boa começa com um olá.",
  "Explore communities": "Explorar comunidades",
  "CONNECTED, IN YOUR ELEMENT.": "CONECTADO, DO SEU JEITO.",
  "Your communities": "Suas comunidades",
  "Discover a community or create a space of your own.":
    "Descubra uma comunidade ou crie seu próprio espaço.",
  "Your missions": "Suas missões",
  "In progress": "Em andamento",
  "View all": "Ver tudo",
  "You're all caught up. Discover your next mission.":
    "Tudo em dia. Descubra sua próxima missão.",
  "Pick up the conversation": "Continue a conversa",
  "All messages": "Todas as mensagens",
  "A little closer, even from here.": "Um pouco mais perto, mesmo daqui.",
  "Connected to Noctis": "Conectado ao Noctis",
  "Reconnecting…": "Reconectando…",
  "Friends online": "Amigos online",
  "Add a friend": "Adicionar amigo",
  "View all friends": "Ver todos os amigos",
  "Happening now": "Acontecendo agora",
  OPEN: "ABERTO",
  "Your voice spaces": "Seus espaços de voz",
  "Join a community to get started": "Entre em uma comunidade para começar",
  "A few familiar faces. Drop in.":
    "Alguns rostos conhecidos. Entre na conversa.",
  "Make a little room for a conversation.": "Abra espaço para uma conversa.",
  "Join voice": "Entrar na voz",
  "On the horizon": "Em breve",
  "Your momentum": "Seu progresso",
  "Making your mark": "Deixando sua marca",
  Level: "Nível",
  Explorer: "Explorador",
  "Progress to next level": "Progresso para o próximo nível",
  "Keep showing up. Good things add up.":
    "Continue participando. Coisas boas se acumulam.",
  "View leaderboard": "Ver classificação",
  "MAKE YOUR MOMENTS COUNT": "FAÇA CADA MOMENTO CONTAR",
  "A little purpose. A lot of possibility.":
    "Um pouco de propósito. Muitas possibilidades.",
  "Learn something, make something, or bring your community a little closer.":
    "Aprenda, crie ou aproxime um pouco mais a sua comunidade.",
  "Create mission": "Criar missão",
  "YOUR NEXT CHAPTER": "SEU PRÓXIMO CAPÍTULO",
  "Good things happen when you show up.":
    "Coisas boas acontecem quando você participa.",
  "One small step at a time. Your next achievement is closer than you think.":
    "Um pequeno passo de cada vez. Sua próxima conquista está mais perto do que parece.",
  Completed: "Concluídas",
  "Total XP": "XP total",
  "My missions": "Minhas missões",
  "Explore missions": "Explorar missões",
  "Find a mission": "Encontrar uma missão",
  "No missions found": "Nenhuma missão encontrada",
  "Your first achievement is waiting": "Sua primeira conquista está esperando",
  "You're all caught up": "Tudo em dia",
  "Explore a challenge and start your next chapter.":
    "Explore um desafio e comece seu próximo capítulo.",
  "Progress at your own pace. Every contribution matters.":
    "Avance no seu ritmo. Toda contribuição importa.",
  "Meet the community leaders": "Conheça os líderes da comunidade",
  "Mission not found": "Missão não encontrada",
  "This mission may have moved. Find your next challenge.":
    "Esta missão pode ter mudado. Encontre seu próximo desafio.",
  "Back to missions": "Voltar às missões",
  Messages: "Mensagens",
  Members: "Membros",
  "Download attachment": "Baixar anexo",
  "Enter to send · Shift + Enter for a new line":
    "Enter para enviar · Shift + Enter para uma nova linha",
  "Good people. Great possibilities.": "Boas pessoas. Grandes possibilidades.",
  "Leave voice room": "Sair da sala de voz",
  "Mute microphone": "Silenciar microfone",
  "Unmute microphone": "Ativar microfone",
  "Turn camera on": "Ligar câmera",
  "Turn camera off": "Desligar câmera",
  "Share screen": "Compartilhar tela",
  "Stop sharing": "Parar compartilhamento",
  "Noise suppression": "Cancelamento de ruído",
  Connected: "Conectado",
  "YOUR WORLD. BEAUTIFULLY CONNECTED.": "SEU MUNDO. BELAMENTE CONECTADO.",
  "A LITTLE CLOSER, EVEN FROM HERE.": "UM POUCO MAIS PERTO, MESMO DAQUI.",
  "A space": "Um espaço",
  "for your": "para a sua",
  "people.": "comunidade.",
  "The conversations that run late.": "As conversas que seguem noite adentro.",
  "The ideas that go somewhere.": "As ideias que ganham vida.",
  "The people who make it all worthwhile.":
    "As pessoas que fazem tudo valer a pena.",
  "GOOD COMPANY. NO DISTANCE.": "BOA COMPANHIA. SEM DISTÂNCIA.",
  "WELCOME TO NOCTIS": "BOAS-VINDAS AO NOCTIS",
  "Good to have you back.": "Que bom ter você de volta.",
  "Create your account. Make a little room for what matters.":
    "Crie sua conta. Abra espaço para o que importa.",
  "Your conversations, communities, and next great idea await.":
    "Suas conversas, comunidades e próximas ideias esperam por você.",
  "Use at least 12 characters for your password.":
    "Use pelo menos 12 caracteres na sua senha.",
  Password: "Senha",
  "At least 12 characters": "Pelo menos 12 caracteres",
  "Your password": "Sua senha",
  "Hide password": "Ocultar senha",
  "Show password": "Mostrar senha",
  "One moment…": "Um momento…",
  "Create account": "Criar conta",
  "Sign in": "Entrar",
  "Continue with {provider}": "Continuar com {provider}",
  "Already have an account? Sign in": "Já tem uma conta? Entrar",
  "New here? Create an account": "Primeira vez aqui? Criar conta",
  "Your account, securely connected.": "Sua conta, conectada com segurança.",
  "MAKE YOURSELF AT HOME": "FIQUE À VONTADE",
  "What brings you here, {name}?": "O que traz você aqui, {name}?",
  "Pick a few interests. There's a space for every side of you.":
    "Escolha alguns interesses. Há espaço para cada lado seu.",
  "Design & creativity": "Design e criatividade",
  Gaming: "Jogos",
  Music: "Música",
  Technology: "Tecnologia",
  Lifestyle: "Estilo de vida",
  "Discover your communities": "Descubra suas comunidades",
  "Dramatic mountain peaks rising through the mist":
    "Picos de montanhas emergindo da neblina",
  "Background call": "Chamada em segundo plano",
  "Return to {name} voice room": "Voltar para a sala de voz {name}",
  "VOICE SPACE": "ESPAÇO DE VOZ",
  "Your people are one conversation away.":
    "Sua comunidade está a uma conversa de distância.",
  "Ready to join": "Pronto para entrar",
  "Settle in. Stay a while.": "Entre e fique à vontade.",
  "Join with your microphone muted. You control when to speak or share.":
    "Entre com o microfone desligado. Você escolhe quando falar ou compartilhar.",
  "Join voice room": "Entrar na sala de voz",
  "Call participants": "Participantes da chamada",
  "Previous people": "Pessoas anteriores",
  "Next people": "Próximas pessoas",
  "{count} person connected": "{count} pessoa conectada",
  "{count} people connected": "{count} pessoas conectadas",
  "Encrypted voice & video": "Voz e vídeo criptografados",
  "Return to voice": "Voltar à voz",
  Undeafen: "Ativar áudio",
  Deafen: "Desativar áudio",
  "Stop sharing screen": "Parar de compartilhar a tela",
  "Share your screen": "Compartilhar sua tela",
  "Turn noise suppression off": "Desativar cancelamento de ruído",
  "Turn noise suppression on": "Ativar cancelamento de ruído",
  Sharing: "Compartilhando",
  "Camera on": "Câmera ligada",
  person: "pessoa",
  people: "pessoas",
  "Search conversations": "Pesquisar conversas",
  "{count} members": "{count} membros",
  "No conversations found": "Nenhuma conversa encontrada",
  "Try another name or clear your search.":
    "Tente outro nome ou limpe a pesquisa.",
  "Create a group": "Criar grupo",
  "A good conversation starts here": "Uma boa conversa começa aqui",
  "Choose someone from the sidebar, or start a new conversation.":
    "Escolha alguém na barra lateral ou inicie uma conversa.",
  "Start conversation": "Iniciar conversa",
  "Load earlier messages": "Carregar mensagens anteriores",
  "Your community": "Sua comunidade",
  "Every good thing starts with a conversation":
    "Toda coisa boa começa com uma conversa",
  "Start voice call": "Iniciar chamada de voz",
  "Show all messages": "Mostrar todas as mensagens",
  "Show pinned messages": "Mostrar mensagens fixadas",
  "Search this conversation": "Pesquisar nesta conversa",
  "View conversation members": "Ver membros da conversa",
  "A space for ideas, little wins, and everything in between.":
    "Um espaço para ideias, pequenas conquistas e tudo o que vier.",
  "Invite a friend": "Convidar um amigo",
  "Pinned messages": "Mensagens fixadas",
  "Back to conversation": "Voltar à conversa",
  "Conversation messages": "Mensagens da conversa",
  "Your conversation with {name}": "Sua conversa com {name}",
  "Welcome to #{channel}": "Boas-vindas ao #{channel}",
  "This is the beginning of something good. Make yourself at home.":
    "Este é o começo de algo bom. Fique à vontade.",
  "Nothing pinned yet": "Nada fixado ainda",
  "No matching messages": "Nenhuma mensagem correspondente",
  "Start the conversation": "Comece a conversa",
  "Pin a message to keep it close.":
    "Fixe uma mensagem para encontrá-la facilmente.",
  "Share an idea, ask a question, or just say hello.":
    "Compartilhe uma ideia, faça uma pergunta ou apenas diga olá.",
  "This voice room is unavailable": "Esta sala de voz está indisponível",
  "Choose an accessible voice channel from your community.":
    "Escolha um canal de voz disponível na sua comunidade.",
  "Try a different phrase or clear your search.":
    "Tente outra frase ou limpe a pesquisa.",
  "Reading your file…": "Lendo seu arquivo…",
  "Message {destination}": "Mensagem {destination}",
  Message: "Mensagem",
  "Invite members": "Convidar membros",
  "{count} tracks added to the queue": "{count} faixas adicionadas à fila",
  "{title} added to the queue": "{title} adicionada à fila",
  "Type a song name or paste a music link":
    "Digite o nome de uma música ou cole um link",
  "Song, artist, or licensed audio URL":
    "Música, artista ou URL de áudio licenciado",
  "Finding…": "Buscando…",
  "Add to queue": "Adicionar à fila",
  "YouTube, Spotify, and SoundCloud use their official players. Licensed direct audio plays through the room bot.":
    "YouTube, Spotify e SoundCloud usam seus players oficiais. Áudio licenciado é reproduzido pelo bot da sala.",
  "Playback position {time}": "Posição da reprodução {time}",
  "Repeat {mode}": "Repetição: {mode}",
  Resume: "Retomar",
  Pause: "Pausar",
  "Skip track": "Pular faixa",
  "Skipped to the next track": "Próxima faixa iniciada",
  "Stop and clear queue": "Parar e limpar a fila",
  "Noctis Music stopped": "Noctis Music parou",
  "Spotify volume is controlled in its player":
    "O volume do Spotify é controlado no próprio player",
  "Music Bot volume": "Volume do bot de música",
  "Spotify controls listening volume in its official player":
    "O Spotify controla o volume no seu player oficial",
  "Music volume set to {volume}%": "Volume da música: {volume}%",
  Player: "Player",
  "Noctis Music participant": "Noctis Music, participante",
  Ready: "Pronto",
  "Another voice room": "Outra sala de voz",
  "Player unavailable": "Player indisponível",
  "Noctis Music controls": "Controles do Noctis Music",
  "The queue is ready": "A fila está pronta",
  "Add a track for the voice room.": "Adicione uma faixa para a sala de voz.",
  "Open music queue": "Abrir fila de músicas",
  "Add a track": "Adicionar faixa",
  READY: "PRONTO",
  CONNECTING: "CONECTANDO",
  "OFFICIAL STREAM": "TRANSMISSÃO OFICIAL",
  "Music is playing in another voice room.":
    "A música está tocando em outra sala de voz.",
  "QUEUE RESTING": "FILA EM ESPERA",
  "NOW PLAYING": "TOCANDO AGORA",
  "A quieter room": "Uma sala mais tranquila",
  "Add a track when the moment is right.":
    "Adicione uma faixa quando chegar a hora.",
  "Requested by": "Pedido de",
  "Up next": "A seguir",
  "{count} tracks": "{count} faixas",
  "Remove {title}": "Remover {title}",
  "The queue is open for the next track.":
    "A fila está aberta para a próxima faixa.",
  "Play here": "Reproduzir aqui",
  "SoundCloud player for {title}": "Player do SoundCloud para {title}",
  "Official {provider} playback": "Reprodução oficial de {provider}",
  "OFFICIAL PROVIDER STREAM": "TRANSMISSÃO OFICIAL",
  "Audio is delivered directly by {provider}. Use Noctis controls to keep the room state aligned.":
    "O áudio é transmitido diretamente por {provider}. Use os controles do Noctis para manter a sala sincronizada.",
  "Your browser may require you to press Play here once before shared controls can start audio.":
    "Seu navegador pode exigir que você pressione Reproduzir aqui uma vez antes de iniciar o áudio.",
  "Spotify keeps listening volume inside its player.":
    "O volume do Spotify é controlado no próprio player.",
};

export function normalizeLanguage(value: unknown): Language {
  return value === "pt-BR" ? "pt-BR" : "en-US";
}

export function translate(
  language: Language,
  text: string,
  values: Record<string, string | number> = {},
) {
  const translated = language === "pt-BR" ? portuguese[text] || text : text;
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    translated,
  );
}

export function useI18n() {
  const store = useStore();
  const language = normalizeLanguage(store.settings.language);
  return {
    language,
    locale: language,
    t: (text: string, values?: Record<string, string | number>) =>
      translate(language, text, values),
  };
}
