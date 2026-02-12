/**
 * Project Manager Modal
 * 
 * Modal for managing New Schedule projects separately from Schedule Tweaker drafts.
 */

import React, { useState, useEffect } from 'react';
import { X, FolderOpen, Clock, Trash2, Edit3, Check, Plus, CalendarPlus, Loader2, Copy, Search } from 'lucide-react';
import { getAllProjects, deleteProject, getProject, duplicateProject, NewScheduleProject } from '../../utils/services/newScheduleProjectService';
import type { MasterRouteTable } from '../../utils/parsers/masterScheduleParser';

interface Props {
    isOpen: boolean;
    userId: string | null;
    currentProjectId?: string;
    onClose: () => void;
    onLoadProject: (project: NewScheduleProject) => void;
    onLoadGeneratedSchedule?: (schedules: MasterRouteTable[], projectName: string, projectId: string) => void;
    onNewProject: () => void;
}

export const ProjectManagerModal: React.FC<Props> = ({
    isOpen,
    userId,
    currentProjectId,
    onClose,
    onLoadProject,
    onLoadGeneratedSchedule,
    onNewProject
}) => {
    const [projects, setProjects] = useState<NewScheduleProject[]>([]);
    const [filteredProjects, setFilteredProjects] = useState<NewScheduleProject[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [selectedProject, setSelectedProject] = useState<NewScheduleProject | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [duplicating, setDuplicating] = useState<string | null>(null);

    // Load projects on open
    useEffect(() => {
        if (isOpen && userId) {
            loadProjects();
        }
    }, [isOpen, userId]);

    // Filter projects when search query changes
    useEffect(() => {
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            setFilteredProjects(
                projects.filter(p =>
                    p.name.toLowerCase().includes(query) ||
                    p.routeNumber?.toLowerCase().includes(query)
                )
            );
        } else {
            setFilteredProjects(projects);
        }
    }, [searchQuery, projects]);

    const loadProjects = async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const data = await getAllProjects(userId);
            setProjects(data);
            setFilteredProjects(data);
        } catch (e) {
            console.error('Failed to load projects:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (projectId: string) => {
        if (!userId) return;
        if (!confirm('Delete this project? This cannot be undone.')) return;

        setDeleting(projectId);
        try {
            await deleteProject(userId, projectId);
            setProjects(prev => prev.filter(p => p.id !== projectId));
            if (selectedProject?.id === projectId) {
                setSelectedProject(null);
            }
        } catch (e) {
            console.error('Failed to delete project:', e);
        } finally {
            setDeleting(null);
        }
    };

    const handleDuplicate = async (projectId: string) => {
        if (!userId) return;
        setDuplicating(projectId);
        try {
            await duplicateProject(userId, projectId);
            await loadProjects(); // Reload to show the new copy
        } catch (e) {
            console.error('Failed to duplicate project:', e);
        } finally {
            setDuplicating(null);
        }
    };

    const formatTime = (date: Date) => {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(mins / 60);
        const days = Math.floor(hours / 24);

        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return date.toLocaleDateString();
    };

    if (!isOpen) return null;

    // Show login prompt if not authenticated
    if (!userId) {
        return (
            <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center animate-in zoom-in-95 duration-200">
                    <FolderOpen className="mx-auto text-gray-300 mb-4" size={48} />
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Sign In Required</h2>
                    <p className="text-gray-500 mb-6">
                        Please sign in to save and load your schedule projects.
                    </p>
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-teal-50">
                    <div className="flex items-center gap-3">
                        <CalendarPlus className="text-emerald-600" size={24} />
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Your Projects</h2>
                            <p className="text-sm text-gray-500">{projects.length} saved project{projects.length !== 1 ? 's' : ''}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { onNewProject(); onClose(); }}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors font-medium"
                        >
                            <Plus size={16} />
                            New Project
                        </button>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="px-6 py-3 border-b border-gray-100">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search projects..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Project List */}
                    <div className="w-1/2 border-r border-gray-100 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 size={24} className="animate-spin text-gray-400" />
                            </div>
                        ) : filteredProjects.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                                <FolderOpen size={48} className="mb-2 opacity-50" />
                                <p>{searchQuery ? 'No projects found' : 'No projects yet'}</p>
                                <p className="text-sm">{searchQuery ? 'Try a different search' : 'Create your first schedule project!'}</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-50">
                                {filteredProjects.map(project => (
                                    <button
                                        key={project.id}
                                        onClick={() => setSelectedProject(project)}
                                        className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors flex items-center gap-3 ${selectedProject?.id === project.id ? 'bg-emerald-50 border-l-4 border-emerald-500' : ''
                                            } ${project.id === currentProjectId ? 'bg-blue-50' : ''}`}
                                    >
                                        <CalendarPlus size={18} className={project.isGenerated ? 'text-emerald-500' : 'text-gray-400'} />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-gray-900 truncate flex items-center gap-2">
                                                {project.name}
                                                {project.id === currentProjectId && (
                                                    <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">current</span>
                                                )}
                                            </div>
                                            <div className="text-sm text-gray-500 flex items-center gap-2">
                                                {project.isGenerated ? (
                                                    <span className="text-emerald-600">Generated</span>
                                                ) : (
                                                    <span className="text-amber-600">In Progress</span>
                                                )}
                                                <span>•</span>
                                                <Clock size={12} />
                                                {formatTime(project.updatedAt)}
                                            </div>
                                        </div>
                                        <span className="text-gray-300">›</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Project Details */}
                    <div className="w-1/2 p-6 bg-gray-50">
                        {selectedProject ? (
                            <div className="space-y-4">
                                <div>
                                    <h3 className="font-bold text-lg text-gray-900">{selectedProject.name}</h3>
                                    <p className="text-sm text-gray-500 mt-1">
                                        {selectedProject.dayType} • Route {selectedProject.routeNumber || 'Not set'}
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div className="bg-white p-3 rounded-lg border border-gray-100">
                                        <div className="text-gray-500">Status</div>
                                        <div className={`font-medium ${selectedProject.isGenerated ? 'text-emerald-600' : 'text-amber-600'}`}>
                                            {selectedProject.isGenerated ? '✓ Generated' : '⏳ In Progress'}
                                        </div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-gray-100">
                                        <div className="text-gray-500">Last Modified</div>
                                        <div className="font-medium text-gray-800">
                                            {selectedProject.updatedAt.toLocaleDateString()}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-2 pt-4">
                                    <button
                                        onClick={async () => {
                                            // If generated and we have the handler, load directly to editor
                                            if (selectedProject.isGenerated && onLoadGeneratedSchedule && userId) {
                                                try {
                                                    const fullProject = await getProject(userId, selectedProject.id);
                                                    if (fullProject?.generatedSchedules && fullProject.generatedSchedules.length > 0) {
                                                        onLoadGeneratedSchedule(fullProject.generatedSchedules, fullProject.name, fullProject.id);
                                                        onClose();
                                                        return;
                                                    }
                                                } catch (e) {
                                                    console.error('Failed to load generated schedule:', e);
                                                }
                                            }
                                            // Fallback to normal project load (resume wizard)
                                            onLoadProject(selectedProject);
                                            onClose();
                                        }}
                                        className="flex-1 bg-emerald-500 text-white py-2.5 rounded-lg font-medium hover:bg-emerald-600 transition-colors"
                                    >
                                        {selectedProject.isGenerated ? 'Open Schedule' : 'Resume Wizard'}
                                    </button>
                                    <button
                                        onClick={() => handleDuplicate(selectedProject.id)}
                                        disabled={duplicating === selectedProject.id}
                                        className="px-4 py-2.5 text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                                        title="Duplicate project"
                                    >
                                        {duplicating === selectedProject.id ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Copy size={16} />
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleDelete(selectedProject.id)}
                                        disabled={deleting === selectedProject.id}
                                        className="px-4 py-2.5 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                                        title="Delete project"
                                    >
                                        {deleting === selectedProject.id ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Trash2 size={16} />
                                        )}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <FolderOpen size={48} className="mb-2 opacity-50" />
                                <p>Select a project</p>
                                <p className="text-sm">to view details and actions</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProjectManagerModal;
