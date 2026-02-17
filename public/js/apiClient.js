const BASE_URL = 'http://195.35.42.56:3000';

// Gerenciamento de autenticação local
export const auth = {
  getUser: () => {
    const user = localStorage.getItem('coelholog_user');
    return user ? JSON.parse(user) : null;
  },

  setUser: (user) => {
    localStorage.setItem('coelholog_user', JSON.stringify(user));
  },

  logout: () => {
    localStorage.removeItem('coelholog_user');
    window.location.href = '/';
  },

  isAuthenticated: () => {
    return !!auth.getUser();
  }
};

// Cliente HTTP
const apiClient = {
  async request(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;

    console.log('🔵 API Request:', { url, method: options.method || 'GET', body: options.body });

    const config = {
      method: options.method || 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    if (options.body) {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, config);

      console.log('🟢 API Response:', { status: response.status, statusText: response.statusText });

      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      if (!response.ok) {
        const msg = (data && data.message) ? data.message : `Erro ${response.status}: ${response.statusText}`;
        throw new Error(msg);
      }

      console.log('✅ API Data:', data);
      return data;
    } catch (error) {
      console.error('🔴 API Error:', error);
      console.error('🔴 Error details:', {
        message: error.message,
        name: error.name,
        url: url
      });

      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        throw new Error('Backend não acessível. Verifique: 1) Backend rodando em http://195.35.42.56:3000, 2) CORS habilitado, 3) Firewall/rede');
      }
      throw error;
    }
  },

  async login(email, password) {
    return this.request('/api/login', {
      method: 'POST',
      body: { email, password }
    });
  },

  async getProducao(usuario_id, mes, ano) {
    return this.request(`/api/producao/colaborador?usuario_id=${usuario_id}&mes=${mes}&ano=${ano}`);
  },

  async createProducao(data) {
    return this.request('/api/producao', {
      method: 'POST',
      body: data
    });
  },

  async getRecebiveis(user_id) {
    return this.request(`/api/recebiveis?user_id=${user_id}`);
  },

  async getEmprestimos(user_id) {
    return this.request(`/api/emprestimos?user_id=${user_id}`);
  },

  async getEmprestimoPendente(usuario_id) {
    return this.request(`/api/emprestimos/pendente?usuario_id=${usuario_id}`);
  },

  async solicitarEmprestimo(usuario_id, valor, parcelamentos) {
    return this.request('/api/emprestimos', {
      method: 'POST',
      body: { usuario_id, valor, parcelamentos }
    });
  },

  async getColaboradores() {
    return this.request('/api/colaboradores');
  },

  async enviarNota(producao_id, arquivo) {
    const formData = new FormData();
    formData.append('producao_id', producao_id);
    formData.append('nota', arquivo);

    const url = `${BASE_URL}/api/producao/enviar-nota`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        body: formData,
      });

      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      if (!response.ok) {
        const msg = (data && data.message) ? data.message : `Erro ${response.status}: ${response.statusText}`;
        throw new Error(msg);
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        throw new Error('Não foi possível conectar ao servidor. Verifique se o backend está rodando e com CORS habilitado.');
      }
      throw error;
    }
  }
};

export default apiClient;
