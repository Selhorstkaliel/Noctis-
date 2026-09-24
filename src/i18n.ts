import { useStore } from "./store";

export const supportedLanguages = ["en-US", "pt-BR"] as const;
export type Language = (typeof supportedLanguages)[number];

const portuguese: Record<string, string> = {
  Image: "Imagem",
  "Close pinned messages": "Fechar mensagens fixadas",
  "Go to message": "Ir atÃ© a mensagem",
  "Go to message by {name}": "Ir atÃ© a mensagem de {name}",
  "We couldn't create this account. Try a different email or username. If you already registered, sign in or reset your password.":
    "NÃ£o foi possÃ­vel criar a conta. Tente outro e-mail ou nome de usuÃ¡rio. Se vocÃª jÃ¡ se cadastrou, entre na conta ou redefina sua senha.",
  "Saving changesâ€¦": "Salvando alteraÃ§Ãµesâ€¦",
  "This file could not be read. Choose it again.":
    "NÃ£o foi possÃ­vel ler o arquivo. Selecione-o novamente.",
  "Choose a JPG, PNG, or WebP no larger than {size} KB.":
    "Escolha uma imagem JPG, PNG ou WebP de atÃ© {size} KB.",
  "Your image could not be read. Try another file.":
    "NÃ£o foi possÃ­vel ler a imagem. Tente outro arquivo.",
  "Add a display name and username before saving.":
    "Preencha o nome de exibiÃ§Ã£o e o nome de usuÃ¡rio antes de salvar.",
  "Use 3â€“30 letters, numbers, dots, or underscores for your username.":
    "Use de 3 a 30 letras, nÃºmeros, pontos ou sublinhados no nome de usuÃ¡rio.",
  "Account security": "SeguranÃ§a da conta",
  "Close dialog": "Fechar janela",
  "Confirm your email before entering Noctis. Check your inbox or request a confirmation link.":
    "Confirme seu e-mail antes de entrar no Noctis. Confira sua caixa de entrada ou solicite um link de confirmaÃ§Ã£o.",
  "Enter the six-digit code from your authenticator.":
    "Digite o cÃ³digo de seis dÃ­gitos do seu autenticador.",
  "Connection failed. Check your internet connection and try again.":
    "Falha na conexÃ£o. Confira sua internet e tente novamente.",
  "Forgot password?": "Esqueceu a senha?",
  "Reset your password": "Redefina sua senha",
  "Choose a new password": "Escolha uma nova senha",
  "Verify your email": "Confirme seu e-mail",
  "Two-factor authentication": "AutenticaÃ§Ã£o em duas etapas",
  "We sent a confirmation link to your email. Confirm it before entering Noctis.":
    "Enviamos um link de confirmaÃ§Ã£o para seu e-mail. Confirme antes de entrar no Noctis.",
  "Enter a code from your authenticator or an unused recovery code.":
    "Digite um cÃ³digo do autenticador ou um cÃ³digo de recuperaÃ§Ã£o ainda nÃ£o utilizado.",
  "Enter your account email. If password recovery is available, we will send a link.":
    "Digite o e-mail da conta. Se a recuperaÃ§Ã£o de senha estiver disponÃ­vel, enviaremos um link.",
  "Confirm this email to finish verifying your account.":
    "Confirme este e-mail para concluir a verificaÃ§Ã£o da conta.",
  "Enter a valid email address.": "Digite um endereÃ§o de e-mail vÃ¡lido.",
  "If password recovery is available for this email, a link is on its way. Check your inbox and spam folder.":
    "Se a recuperaÃ§Ã£o de senha estiver disponÃ­vel para este e-mail, vocÃª receberÃ¡ um link. Confira sua caixa de entrada e o spam.",
  "Email verified. You can now continue.":
    "E-mail confirmado. VocÃª jÃ¡ pode continuar.",
  "Password changed. All sessions were signed out. Sign in with your new password.":
    "Senha alterada. Todas as sessÃµes foram encerradas. Entre com sua nova senha.",
  "Authenticator or recovery code": "CÃ³digo do autenticador ou de recuperaÃ§Ã£o",
  "Required only if two-factor authentication is enabled.":
    "ObrigatÃ³rio apenas se a autenticaÃ§Ã£o em duas etapas estiver ativa.",
  "Verify and sign in": "Verificar e entrar",
  "Send recovery link": "Enviar link de recuperaÃ§Ã£o",
  "Reset password": "Redefinir senha",
  "Confirm email": "Confirmar e-mail",
  "Open the link from your email. If it expired, request a new one.":
    "Abra o link recebido por e-mail. Se ele expirou, solicite um novo.",
  "I confirmed my email": "JÃ¡ confirmei meu e-mail",
  "Your email has not been confirmed yet. Open the link in your inbox.":
    "Seu e-mail ainda nÃ£o foi confirmado. Abra o link na sua caixa de entrada.",
  "A new confirmation link is on its way. Previous links no longer work.":
    "Um novo link de confirmaÃ§Ã£o serÃ¡ enviado. Os links anteriores nÃ£o funcionam mais.",
  "Resend in {seconds}s": "Reenviar em {seconds}s",
  "Resend confirmation email": "Reenviar e-mail de confirmaÃ§Ã£o",
  "Back to sign in": "Voltar para entrar",
  "Show {label}": "Mostrar {label}",
  "Hide {label}": "Ocultar {label}",
  Show: "Mostrar",
  Hide: "Ocultar",
  "Loading account securityâ€¦": "Carregando seguranÃ§a da contaâ€¦",
  Verified: "Confirmado",
  "Not verified": "NÃ£o confirmado",
  "Your account requires an authenticator or recovery code when you sign in.":
    "Sua conta exige um cÃ³digo do autenticador ou de recuperaÃ§Ã£o para entrar.",
  "Add a second step to protect your account, including provider sign-ins.":
    "Adicione uma segunda etapa para proteger sua conta, inclusive ao entrar com Google ou GitHub.",
  "{count} recovery codes remaining":
    "{count} cÃ³digos de recuperaÃ§Ã£o restantes",
  Enabled: "Ativada",
  Disabled: "Desativada",
  "Replace recovery codes": "Substituir cÃ³digos de recuperaÃ§Ã£o",
  "Disable two-factor authentication": "Desativar autenticaÃ§Ã£o em duas etapas",
  "Set up authenticator": "Configurar autenticador",
  "Save your recovery codes": "Guarde seus cÃ³digos de recuperaÃ§Ã£o",
  "These codes will not be shown again. Close without saving them?":
    "Estes cÃ³digos nÃ£o serÃ£o exibidos novamente. Fechar sem guardÃ¡-los?",
  "Authenticator setup is not finished. Close setup?":
    "A configuraÃ§Ã£o do autenticador nÃ£o foi concluÃ­da. Fechar configuraÃ§Ã£o?",
  "Keep open": "Manter aberto",
  "Each code works once. Keep these codes somewhere safe, separate from your password. They will not be shown again.":
    "Cada cÃ³digo funciona uma vez. Guarde-os em um lugar seguro, separado da sua senha. Eles nÃ£o serÃ£o exibidos novamente.",
  "Hide recovery codes": "Ocultar cÃ³digos de recuperaÃ§Ã£o",
  "Show recovery codes": "Mostrar cÃ³digos de recuperaÃ§Ã£o",
  "I saved my recovery codes": "Guardei meus cÃ³digos de recuperaÃ§Ã£o",
  "Your account will stop requiring a second factor. All other sessions will be signed out.":
    "Sua conta deixarÃ¡ de exigir a segunda etapa. Todas as outras sessÃµes serÃ£o encerradas.",
  "All previous recovery codes will stop working. Other sessions will be signed out.":
    "Todos os cÃ³digos de recuperaÃ§Ã£o anteriores deixarÃ£o de funcionar. As outras sessÃµes serÃ£o encerradas.",
  "Use an authenticator app. Setup expires after 10 minutes. Other sessions will be signed out when you enable it.":
    "Use um aplicativo autenticador. A configuraÃ§Ã£o expira em 10 minutos. As outras sessÃµes serÃ£o encerradas apÃ³s a ativaÃ§Ã£o.",
  "For provider accounts, sign in again if your session is more than 5 minutes old.":
    "Para contas do Google ou GitHub, entre novamente se sua sessÃ£o tiver mais de 5 minutos.",
  "Scan this QR code with your authenticator, then enter its six-digit code.":
    "Leia este QR code com seu autenticador e digite o cÃ³digo de seis dÃ­gitos.",
  "Authenticator setup QR code": "QR code de configuraÃ§Ã£o do autenticador",
  "Manual setup key": "Chave de configuraÃ§Ã£o manual",
  "Six-digit code": "CÃ³digo de seis dÃ­gitos",
  "Enable two-factor authentication": "Ativar autenticaÃ§Ã£o em duas etapas",
  "Change password": "Alterar senha",
  "Current password": "Senha atual",
  "New password": "Nova senha",
  "Confirm new password": "Confirmar nova senha",
  "Update password": "Atualizar senha",
  "The new passwords do not match.": "As novas senhas nÃ£o coincidem.",
  "Password updated. Other devices have been signed out.":
    "Senha atualizada. As sessÃµes dos outros dispositivos foram encerradas.",
  "Current password is incorrect.": "A senha atual estÃ¡ incorreta.",
  "This link expired or was already used. Request a new email.":
    "Este link expirou ou jÃ¡ foi utilizado. Solicite um novo e-mail.",
  "Invalid or already used code. Try the next authenticator code or a recovery code.":
    "CÃ³digo invÃ¡lido ou jÃ¡ utilizado. Use o prÃ³ximo cÃ³digo do autenticador ou um cÃ³digo de recuperaÃ§Ã£o.",
  "Your sign-in request expired. Sign in again.":
    "Sua solicitaÃ§Ã£o de entrada expirou. Entre novamente.",
  "Sign in again before changing account security.":
    "Entre novamente antes de alterar a seguranÃ§a da conta.",
  "Verify your email before continuing.":
    "Confirme seu e-mail antes de continuar.",
  "Authenticator setup expired. Start setup again.":
    "A configuraÃ§Ã£o do autenticador expirou. Comece novamente.",
  "Two-factor authentication is already enabled.":
    "A autenticaÃ§Ã£o em duas etapas jÃ¡ estÃ¡ ativa.",
  "Too many attempts. Please wait before trying again.":
    "Muitas tentativas. Aguarde antes de tentar novamente.",
  Home: "InÃ­cio",
  "Direct messages": "Mensagens diretas",
  Missions: "MissÃµes",
  Events: "Eventos",
  "Discover servers": "Descobrir servidores",
  Discover: "Descobrir",
  Integrations: "IntegraÃ§Ãµes",
  "The Lounge": "O SalÃ£o",
  "Welcome to Noctis": "Boas-vindas ao Noctis",
  "Server administration": "AdministraÃ§Ã£o do servidor",
  "Find your way": "Encontre seu caminho",
  "Main navigation": "NavegaÃ§Ã£o principal",
  Explore: "Explorar",
  "Invite your people": "Convide sua comunidade",
  "Create a server": "Criar servidor",
  "Open {name}": "Abrir {name}",
  "{count} unread notifications": "{count} notificaÃ§Ãµes nÃ£o lidas",
  NEW: "NOVO",
  "{count} new": "{count} novas",
  "{count} online": "{count} online",
  Joined: "Participando",
  "{done} of {total} objectives": "{done} de {total} objetivos",
  "{name} progress": "Progresso de {name}",
  "YOUR COMMUNITIES": "SUAS COMUNIDADES",
  "RECENT CONVERSATIONS": "CONVERSAS RECENTES",
  "New conversation": "Nova conversa",
  "A space for your people.": "Um espaÃ§o para a sua comunidade.",
  "Make yourself at home.": "Fique Ã  vontade.",
  "User settings": "ConfiguraÃ§Ãµes do usuÃ¡rio",
  Online: "Online",
  Away: "Ausente",
  Invisible: "InvisÃ­vel",
  "Try again": "Tentar novamente",
  "Finding your spaceâ€¦": "Encontrando seu espaÃ§oâ€¦",
  "Your space is temporarily out of reach.":
    "Seu espaÃ§o estÃ¡ temporariamente indisponÃ­vel.",
  "Connecting securely to Noctis.": "Conectando com seguranÃ§a ao Noctis.",
  "A little off the map.": "Um pouco fora do mapa.",
  "That space doesn't exist. Your people are still here.":
    "Esse espaÃ§o nÃ£o existe. Sua comunidade continua aqui.",
  "Back to Home": "Voltar ao inÃ­cio",
  "Skip to content": "Pular para o conteÃºdo",
  "Server switcher": "Seletor de servidores",
  "Noctis Home": "InÃ­cio do Noctis",
  "Keyboard shortcuts": "Atalhos de teclado",
  "Open navigation": "Abrir navegaÃ§Ã£o",
  "Your world, a little closer.": "Seu mundo, um pouco mais perto.",
  "A place for the everyday conversations.":
    "Um lugar para as conversas do dia a dia.",
  "All caught up with your world": "Tudo em dia com o seu mundo",
  "Search Noctis": "Pesquisar no Noctis",
  Notifications: "NotificaÃ§Ãµes",
  "View members and friends": "Ver membros e amigos",
  "Browser storage is full. Changes will last for this session. Remove a large attachment or allow browser storage.":
    "O armazenamento do navegador estÃ¡ cheio. As alteraÃ§Ãµes durarÃ£o apenas nesta sessÃ£o. Remova um anexo grande ou permita o armazenamento.",
  "You're offline. Your local conversations and drafts are still available.":
    "VocÃª estÃ¡ offline. Suas conversas locais e rascunhos continuam disponÃ­veis.",
  "Your spaces": "Seus espaÃ§os",
  "Sign out": "Sair",
  "My account": "Minha conta",
  "Privacy & safety": "Privacidade e seguranÃ§a",
  Appearance: "AparÃªncia",
  "Voice & devices": "Voz e dispositivos",
  Connections: "ConexÃµes",
  "Language & region": "Idioma e regiÃ£o",
  Settings: "ConfiguraÃ§Ãµes",
  "YOUR NOCTIS": "SEU NOCTIS",
  "A little about you. Make it feel like home.":
    "Um pouco sobre vocÃª. Deixe este espaÃ§o com a sua cara.",
  "Set things up the way you like them.":
    "Configure tudo do jeito que vocÃª preferir.",
  "Change avatar": "Alterar foto",
  "Email address": "EndereÃ§o de e-mail",
  "Display name": "Nome de exibiÃ§Ã£o",
  Username: "Nome de usuÃ¡rio",
  "This is how your people find you.": "Ã‰ assim que as pessoas encontram vocÃª.",
  "About me": "Sobre mim",
  "Custom status": "Status personalizado",
  Presence: "PresenÃ§a",
  "Your profile is saved to your account and follows you across devices.":
    "Seu perfil Ã© salvo na conta e acompanha vocÃª em todos os dispositivos.",
  "Choose your comfort zone.": "Escolha seu nÃ­vel de privacidade.",
  "Allow conversations with people in your communities.":
    "Permitir conversas com pessoas das suas comunidades.",
  "Friend requests": "SolicitaÃ§Ãµes de amizade",
  "Let other members find you and send a friend request.":
    "Permitir que outros membros encontrem vocÃª e enviem uma solicitaÃ§Ã£o de amizade.",
  "Activity status": "Status de atividade",
  "Share what you're playing, listening to, or working on.":
    "Compartilhar o que vocÃª estÃ¡ jogando, ouvindo ou fazendo.",
  "Your privacy settings control access across Noctis.":
    "Suas configuraÃ§Ãµes de privacidade controlam o acesso em todo o Noctis.",
  "Find your shade of night.": "Encontre o seu tom da noite.",
  "Smooth motion": "Movimento suave",
  "Subtle transitions that make your space feel a little more alive. Your system's reduced-motion preference always takes priority.":
    "TransiÃ§Ãµes sutis deixam seu espaÃ§o mais vivo. A preferÃªncia de movimento reduzido do sistema sempre tem prioridade.",
  "Your appearance preference follows you throughout Noctis on this browser.":
    "Sua preferÃªncia de aparÃªncia acompanha vocÃª no Noctis neste navegador.",
  "Stay in the loop. Keep your peace.":
    "Acompanhe o que importa sem perder a tranquilidade.",
  "In-app notifications": "NotificaÃ§Ãµes no aplicativo",
  "Show activity in your notification center.":
    "Mostrar atividades na central de notificaÃ§Ãµes.",
  "Mentions & replies": "MenÃ§Ãµes e respostas",
  "Get a heads-up when the conversation includes you.":
    "Receber um aviso quando vocÃª participar da conversa.",
  "Notification sounds": "Sons de notificaÃ§Ã£o",
  "Play a subtle sound for new message notifications.":
    "Reproduzir um som discreto para novas mensagens.",
  "Your notification preferences are saved to your account.":
    "Suas preferÃªncias de notificaÃ§Ã£o sÃ£o salvas na conta.",
  "A little more of your world.": "Um pouco mais do seu mundo.",
  "Account connected": "Conta conectada",
  Manage: "Gerenciar",
  "You haven't connected any external accounts yet.":
    "VocÃª ainda nÃ£o conectou nenhuma conta externa.",
  "Explore integrations": "Explorar integraÃ§Ãµes",
  "Choose how Noctis speaks to you.": "Escolha como o Noctis fala com vocÃª.",
  "Language changes after you save and follows your account on every device.":
    "O idioma muda depois de salvar e acompanha sua conta em todos os dispositivos.",
  English: "InglÃªs",
  Portuguese: "PortuguÃªs",
  "United States": "Estados Unidos",
  Brazil: "Brasil",
  "You have unsaved changes.": "VocÃª tem alteraÃ§Ãµes nÃ£o salvas.",
  "You're all set.": "Tudo pronto.",
  Reset: "Redefinir",
  "Save changes": "Salvar alteraÃ§Ãµes",
  "Changes saved": "AlteraÃ§Ãµes salvas",
  "Leave these changes behind?": "Descartar estas alteraÃ§Ãµes?",
  "Keep editing": "Continuar editando",
  "Discard changes": "Descartar alteraÃ§Ãµes",
  "YOUR SPACE. YOUR PEOPLE.": "SEU ESPAÃ‡O. SUA COMUNIDADE.",
  morning: "bom dia",
  afternoon: "boa tarde",
  evening: "boa noite",
  "A little connection goes a long way. Welcome back.":
    "Um pouco de conexÃ£o faz toda a diferenÃ§a. Que bom ter vocÃª de volta.",
  "MORE THAN A CONVERSATION": "MAIS QUE UMA CONVERSA",
  "Find your people.": "Encontre sua comunidade.",
  "Make your space.": "Crie o seu espaÃ§o.",
  "Somewhere to belong. Something to build.":
    "Um lugar para pertencer. Algo para construir.",
  "The next good thing starts with a hello.":
    "A prÃ³xima coisa boa comeÃ§a com um olÃ¡.",
  "Explore communities": "Explorar comunidades",
  "CONNECTED, IN YOUR ELEMENT.": "CONECTADO, DO SEU JEITO.",
  "Your communities": "Suas comunidades",
  "Discover a community or create a space of your own.":
    "Descubra uma comunidade ou crie seu prÃ³prio espaÃ§o.",
  "Your missions": "Suas missÃµes",
  "In progress": "Em andamento",
  "View all": "Ver tudo",
  "You're all caught up. Discover your next mission.":
    "Tudo em dia. Descubra sua prÃ³xima missÃ£o.",
  "Pick up the conversation": "Continue a conversa",
  "All messages": "Todas as mensagens",
  "A little closer, even from here.": "Um pouco mais perto, mesmo daqui.",
  "Connected to Noctis": "Conectado ao Noctis",
  "Reconnectingâ€¦": "Reconectandoâ€¦",
  "Friends online": "Amigos online",
  "Add a friend": "Adicionar amigo",
  "View all friends": "Ver todos os amigos",
  "Happening now": "Acontecendo agora",
  OPEN: "ABERTO",
  "Your voice spaces": "Seus espaÃ§os de voz",
  "Join a community to get started": "Entre em uma comunidade para comeÃ§ar",
  "A few familiar faces. Drop in.":
    "Alguns rostos conhecidos. Entre na conversa.",
  "Make a little room for a conversation.": "Abra espaÃ§o para uma conversa.",
  "Join voice": "Entrar na voz",
  "On the horizon": "Em breve",
  "Your momentum": "Seu progresso",
  "Making your mark": "Deixando sua marca",
  Level: "NÃ­vel",
  Explorer: "Explorador",
  "Progress to next level": "Progresso para o prÃ³ximo nÃ­vel",
  "Keep showing up. Good things add up.":
    "Continue participando. Coisas boas se acumulam.",
  "View leaderboard": "Ver classificaÃ§Ã£o",
  "MAKE YOUR MOMENTS COUNT": "FAÃ‡A CADA MOMENTO CONTAR",
  "A little purpose. A lot of possibility.":
    "Um pouco de propÃ³sito. Muitas possibilidades.",
  "Learn something, make something, or bring your community a little closer.":
    "Aprenda, crie ou aproxime um pouco mais a sua comunidade.",
  "Create mission": "Criar missÃ£o",
  "YOUR NEXT CHAPTER": "SEU PRÃ“XIMO CAPÃTULO",
  "Good things happen when you show up.":
    "Coisas boas acontecem quando vocÃª participa.",
  "One small step at a time. Your next achievement is closer than you think.":
    "Um pequeno passo de cada vez. Sua prÃ³xima conquista estÃ¡ mais perto do que parece.",
  Completed: "ConcluÃ­das",
  "Total XP": "XP total",
  "My missions": "Minhas missÃµes",
  "Explore missions": "Explorar missÃµes",
  "Find a mission": "Encontrar uma missÃ£o",
  "No missions found": "Nenhuma missÃ£o encontrada",
  "Your first achievement is waiting": "Sua primeira conquista estÃ¡ esperando",
  "You're all caught up": "Tudo em dia",
  "Explore a challenge and start your next chapter.":
    "Explore um desafio e comece seu prÃ³ximo capÃ­tulo.",
  "Progress at your own pace. Every contribution matters.":
    "Avance no seu ritmo. Toda contribuiÃ§Ã£o importa.",
  "Meet the community leaders": "ConheÃ§a os lÃ­deres da comunidade",
  "Mission not found": "MissÃ£o nÃ£o encontrada",
  "This mission may have moved. Find your next challenge.":
    "Esta missÃ£o pode ter mudado. Encontre seu prÃ³ximo desafio.",
  "Back to missions": "Voltar Ã s missÃµes",
  Messages: "Mensagens",
  Members: "Membros",
  "Download attachment": "Baixar anexo",
  "Enter to send Â· Shift + Enter for a new line":
    "Enter para enviar Â· Shift + Enter para uma nova linha",
  "Good people. Great possibilities.": "Boas pessoas. Grandes possibilidades.",
  "Leave voice room": "Sair da sala de voz",
  "Mute microphone": "Silenciar microfone",
  "Unmute microphone": "Ativar microfone",
  "Turn camera on": "Ligar cÃ¢mera",
  "Turn camera off": "Desligar cÃ¢mera",
  "Share screen": "Compartilhar tela",
  "Stop sharing": "Parar compartilhamento",
  "Noise suppression": "Cancelamento de ruÃ­do",
  Connected: "Conectado",
  "YOUR WORLD. BEAUTIFULLY CONNECTED.": "SEU MUNDO. BELAMENTE CONECTADO.",
  "A LITTLE CLOSER, EVEN FROM HERE.": "UM POUCO MAIS PERTO, MESMO DAQUI.",
  "A space": "Um espaÃ§o",
  "for your": "para a sua",
  "people.": "comunidade.",
  "The conversations that run late.": "As conversas que seguem noite adentro.",
  "The ideas that go somewhere.": "As ideias que ganham vida.",
  "The people who make it all worthwhile.":
    "As pessoas que fazem tudo valer a pena.",
  "GOOD COMPANY. NO DISTANCE.": "BOA COMPANHIA. SEM DISTÃ‚NCIA.",
  "WELCOME TO NOCTIS": "BOAS-VINDAS AO NOCTIS",
  "Good to have you back.": "Que bom ter vocÃª de volta.",
  "Create your account. Make a little room for what matters.":
    "Crie sua conta. Abra espaÃ§o para o que importa.",
  "Your conversations, communities, and next great idea await.":
    "Suas conversas, comunidades e prÃ³ximas ideias esperam por vocÃª.",
  "Use at least 12 characters for your password.":
    "Use pelo menos 12 caracteres na sua senha.",
  Password: "Senha",
  "At least 12 characters": "Pelo menos 12 caracteres",
  "Your password": "Sua senha",
  "Hide password": "Ocultar senha",
  "Show password": "Mostrar senha",
  "One momentâ€¦": "Um momentoâ€¦",
  "Create account": "Criar conta",
  "Sign in": "Entrar",
  "Continue with {provider}": "Continuar com {provider}",
  "Already have an account? Sign in": "JÃ¡ tem uma conta? Entrar",
  "New here? Create an account": "Primeira vez aqui? Criar conta",
  "Your account, securely connected.": "Sua conta, conectada com seguranÃ§a.",
  "MAKE YOURSELF AT HOME": "FIQUE Ã€ VONTADE",
  "What brings you here, {name}?": "O que traz vocÃª aqui, {name}?",
  "Pick a few interests. There's a space for every side of you.":
    "Escolha alguns interesses. HÃ¡ espaÃ§o para cada lado seu.",
  "Design & creativity": "Design e criatividade",
  Gaming: "Jogos",
  Music: "MÃºsica",
  Technology: "Tecnologia",
  Lifestyle: "Estilo de vida",
  "Discover your communities": "Descubra suas comunidades",
  "Dramatic mountain peaks rising through the mist":
    "Picos de montanhas emergindo da neblina",
  "Background call": "Chamada em segundo plano",
  "Return to {name} voice room": "Voltar para a sala de voz {name}",
  "VOICE SPACE": "ESPAÃ‡O DE VOZ",
  "Your people are one conversation away.":
    "Sua comunidade estÃ¡ a uma conversa de distÃ¢ncia.",
  "Ready to join": "Pronto para entrar",
  "Settle in. Stay a while.": "Entre e fique Ã  vontade.",
  "Join with your microphone muted. You control when to speak or share.":
    "Entre com o microfone desligado. VocÃª escolhe quando falar ou compartilhar.",
  "Join voice room": "Entrar na sala de voz",
  "Call participants": "Participantes da chamada",
  "Previous people": "Pessoas anteriores",
  "Next people": "PrÃ³ximas pessoas",
  "{count} person connected": "{count} pessoa conectada",
  "{count} people connected": "{count} pessoas conectadas",
  "Encrypted voice & video": "Voz e vÃ­deo criptografados",
  "Return to voice": "Voltar Ã  voz",
  Undeafen: "Ativar Ã¡udio",
  Deafen: "Desativar Ã¡udio",
  "Stop sharing screen": "Parar de compartilhar a tela",
  "Share your screen": "Compartilhar sua tela",
  "Cancel screen sharing": "Cancelar compartilhamento de tela",
  "Choose whether people in the call should also hear audio from the shared source.":
    "Escolha se as pessoas na chamada tambÃ©m devem ouvir o Ã¡udio da fonte compartilhada.",
  "Share with sound": "Compartilhar com som",
  "People will hear audio offered by the selected source.":
    "As pessoas ouvirÃ£o o Ã¡udio disponibilizado pela fonte selecionada.",
  "Share without sound": "Compartilhar sem som",
  "Only the screen image will be shared.":
    "Apenas a imagem da tela serÃ¡ compartilhada.",
  "Audio availability depends on the browser and the window, tab, or screen you select next.":
    "A disponibilidade do Ã¡udio depende do navegador e da janela, aba ou tela escolhida a seguir.",
  "This source does not provide audio. The screen is being shared without sound.":
    "Esta fonte nÃ£o fornece Ã¡udio. A tela estÃ¡ sendo compartilhada sem som.",
  "Turn noise suppression off": "Desativar cancelamento de ruÃ­do",
  "Turn noise suppression on": "Ativar cancelamento de ruÃ­do",
  Sharing: "Compartilhando",
  "Camera on": "CÃ¢mera ligada",
  person: "pessoa",
  people: "pessoas",
  "Search conversations": "Pesquisar conversas",
  "{count} members": "{count} membros",
  "No conversations found": "Nenhuma conversa encontrada",
  "Try another name or clear your search.":
    "Tente outro nome ou limpe a pesquisa.",
  "Create a group": "Criar grupo",
  "A good conversation starts here": "Uma boa conversa comeÃ§a aqui",
  "Choose someone from the sidebar, or start a new conversation.":
    "Escolha alguÃ©m na barra lateral ou inicie uma conversa.",
  "Start conversation": "Iniciar conversa",
  "Load earlier messages": "Carregar mensagens anteriores",
  "Your community": "Sua comunidade",
  "Every good thing starts with a conversation":
    "Toda coisa boa comeÃ§a com uma conversa",
  "Start voice call": "Iniciar chamada de voz",
  "Show all messages": "Mostrar todas as mensagens",
  "Show pinned messages": "Mostrar mensagens fixadas",
  "Search this conversation": "Pesquisar nesta conversa",
  "View conversation members": "Ver membros da conversa",
  "A space for ideas, little wins, and everything in between.":
    "Um espaÃ§o para ideias, pequenas conquistas e tudo o que vier.",
  "Invite a friend": "Convidar um amigo",
  "Pinned messages": "Mensagens fixadas",
  "Back to conversation": "Voltar Ã  conversa",
  "Conversation messages": "Mensagens da conversa",
  "Your conversation with {name}": "Sua conversa com {name}",
  "Welcome to #{channel}": "Boas-vindas ao #{channel}",
  "This is the beginning of something good. Make yourself at home.":
    "Este Ã© o comeÃ§o de algo bom. Fique Ã  vontade.",
  "Nothing pinned yet": "Nada fixado ainda",
  "No matching messages": "Nenhuma mensagem correspondente",
  "Start the conversation": "Comece a conversa",
  "Pin a message to keep it close.":
    "Fixe uma mensagem para encontrÃ¡-la facilmente.",
  "Share an idea, ask a question, or just say hello.":
    "Compartilhe uma ideia, faÃ§a uma pergunta ou apenas diga olÃ¡.",
  "This voice room is unavailable": "Esta sala de voz estÃ¡ indisponÃ­vel",
  "Choose an accessible voice channel from your community.":
    "Escolha um canal de voz disponÃ­vel na sua comunidade.",
  "Try a different phrase or clear your search.":
    "Tente outra frase ou limpe a pesquisa.",
  "Reading your fileâ€¦": "Lendo seu arquivoâ€¦",
  "Message {destination}": "Mensagem {destination}",
  Message: "Mensagem",
  "Invite members": "Convidar membros",
  "{count} tracks added to the queue": "{count} faixas adicionadas Ã  fila",
  "{title} added to the queue": "{title} adicionada Ã  fila",
  "Type a song name or paste a music link":
    "Digite o nome de uma mÃºsica ou cole um link",
  "Song, artist, or licensed audio URL":
    "MÃºsica, artista ou URL de Ã¡udio licenciado",
  "Findingâ€¦": "Buscandoâ€¦",
  "Add to queue": "Adicionar Ã  fila",
  "YouTube, Spotify, and SoundCloud use their official players. Licensed direct audio plays through the room bot.":
    "YouTube, Spotify e SoundCloud usam seus players oficiais. Ãudio licenciado Ã© reproduzido pelo bot da sala.",
  "Playback position {time}": "PosiÃ§Ã£o da reproduÃ§Ã£o {time}",
  "Repeat {mode}": "RepetiÃ§Ã£o: {mode}",
  Resume: "Retomar",
  Pause: "Pausar",
  "Skip track": "Pular faixa",
  "Skipped to the next track": "PrÃ³xima faixa iniciada",
  "Stop and clear queue": "Parar e limpar a fila",
  "Noctis Music stopped": "Noctis Music parou",
  "Spotify volume is controlled in its player":
    "O volume do Spotify Ã© controlado no prÃ³prio player",
  "Music Bot volume": "Volume do bot de mÃºsica",
  "Spotify controls listening volume in its official player":
    "O Spotify controla o volume no seu player oficial",
  "Music volume set to {volume}%": "Volume da mÃºsica: {volume}%",
  Player: "Player",
  "Noctis Music participant": "Noctis Music, participante",
  Ready: "Pronto",
  "Another voice room": "Outra sala de voz",
  "Player unavailable": "Player indisponÃ­vel",
  "Noctis Music controls": "Controles do Noctis Music",
  "The queue is ready": "A fila estÃ¡ pronta",
  "Add a track for the voice room.": "Adicione uma faixa para a sala de voz.",
  "Open music queue": "Abrir fila de mÃºsicas",
  "Add a track": "Adicionar faixa",
  READY: "PRONTO",
  CONNECTING: "CONECTANDO",
  "OFFICIAL STREAM": "TRANSMISSÃƒO OFICIAL",
  "Music is playing in another voice room.":
    "A mÃºsica estÃ¡ tocando em outra sala de voz.",
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
    "A fila estÃ¡ aberta para a prÃ³xima faixa.",
  "Play here": "Reproduzir aqui",
  "SoundCloud player for {title}": "Player do SoundCloud para {title}",
  "Official {provider} playback": "ReproduÃ§Ã£o oficial de {provider}",
  "OFFICIAL PROVIDER STREAM": "TRANSMISSÃƒO OFICIAL",
  "Audio is delivered directly by {provider}. Use Noctis controls to keep the room state aligned.":
    "O Ã¡udio Ã© transmitido diretamente por {provider}. Use os controles do Noctis para manter a sala sincronizada.",
  "Your browser may require you to press Play here once before shared controls can start audio.":
    "Seu navegador pode exigir que vocÃª pressione Reproduzir aqui uma vez antes de iniciar o Ã¡udio.",
  "Spotify keeps listening volume inside its player.":
    "O volume do Spotify Ã© controlado no prÃ³prio player.",
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

