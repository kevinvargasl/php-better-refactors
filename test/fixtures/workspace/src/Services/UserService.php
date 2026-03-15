<?php

namespace App\Services;

use App\Models\User;
use App\Models\Post;
use App\Exceptions\UserNotFoundException;

class UserService
{
    /**
     * @var User[]
     */
    private array $users = [];

    public function findUser(int $id): User
    {
        foreach ($this->users as $user) {
            if ($user->id === $id) {
                return $user;
            }
        }

        throw new UserNotFoundException("User {$id} not found");
    }

    public function createUser(string $name, ?string $email = null): User
    {
        $user = new User($name, $email);
        $this->users[] = $user;
        return $user;
    }

    public function getUserPosts(User $user): array
    {
        return [];
    }

    public function isUser(mixed $entity): bool
    {
        return $entity instanceof User;
    }

    public function getUserClass(): string
    {
        return User::class;
    }
}
